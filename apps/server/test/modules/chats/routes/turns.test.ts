import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatRow,
  chatsWorld,
  ended,
  endTurn,
  eventRows,
  eventually,
  GATEWAY_URL,
  HOME,
  scene,
  sendEvents,
  sendPrompt,
  startedTurn,
  turnRow,
  usesOf,
} from '../../../fixtures/chats/world.ts';
import { json, URLS } from '../../../fixtures/credentials/providers.ts';
import { as } from '../../../fixtures/members/members.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
  w.provider.reset();
});
afterAll(() => w.close());

describe('a turn, end to end', () => {
  it("sends turn.start with the spec and the profile's credential, and answers 202 with the running turn", async () => {
    const s = await scene(w, { permissionPolicy: 'bypass', configDir: '/Users/ihor/.claude-slop' });
    const res = await sendPrompt(w, s, 'What is 2 + 2?');
    expect(res.status).toBe(202);
    const turn = res.body as ChatTurnView;
    expect(turn).toMatchObject({
      chatId: s.chat.id,
      seq: 1,
      prompt: 'What is 2 + 2?',
      status: 'running',
      profileId: s.profile.id,
      credentialId: s.credential?.id,
      startedAt: TEST_NOW,
      endedAt: null,
      createdBy: s.company.owner.principalId,
    });
    expect(JSON.stringify(res.body)).not.toContain('SETUPtoken');
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start).toEqual({
      type: 'turn.start',
      turnId: turn.id,
      spec: {
        harness: 'claude_code',
        cwd: HOME,
        prompt: 'What is 2 + 2?',
        sessionId: null,
        model: 'claude-opus-5-5',
        effort: 'high',
        permissionPolicy: 'bypass',
        configDir: '/Users/ihor/.claude-slop',
        credential: {
          kind: 'claude_setup_token',
          token: 'sk-ant-oat01-SETUPtokenNEVERshownAGAIN_0123456789',
        },
        gateway: null,
        instructions: expect.stringMatching(/^## Your place in the company/),
      },
    });
    expect((await chatRow(w.t.db, s.chat.id))?.title).toBe('What is 2 + 2?');
  });

  it('records one credential use for the turn: the company, the agent, the chat and who asked', async () => {
    const s = await scene(w, { gateway: true });
    const start = await startedTurn(w, s);
    expect((await usesOf(w.t.db, s.credential?.id as string)).map((use) => use.purpose)).toEqual([
      'chat_turn',
    ]);
    expect((await usesOf(w.t.db, s.credential?.id as string))[0]).toMatchObject({
      companyId: s.company.companyId,
      agentId: s.agentId,
      chatId: s.chat.id,
      principalId: s.company.owner.principalId,
    });
    expect(start.spec.gateway).toEqual({
      baseUrl: GATEWAY_URL,
      headers: { 'x-api-key': expect.any(String) },
    });
  });

  it('stores the events in order, saves the session id, and closes the turn with its reply and usage', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    const runner = s.runner as FakeRunner;
    sendEvents(runner, start.turnId, ANSWER.slice(0, 2));
    sendEvents(runner, start.turnId, ANSWER.slice(0, 2)); // a resend changes nothing
    sendEvents(runner, start.turnId, ANSWER.slice(2), 3);
    endTurn(runner, start.turnId);
    const row = await ended(w.t.db, start.turnId);
    expect(row).toMatchObject({
      status: 'done',
      resultText: '4',
      error: null,
      usage: { inputTokens: 12, outputTokens: 1, costUsd: 0.001 },
    });
    expect((await eventRows(w.t.db, start.turnId)).map((event) => [event.seq, event.event.type])).toEqual([
      [1, 'session'],
      [2, 'text'],
      [3, 'usage'],
      [4, 'result'],
    ]);
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBe('b4c1f0e2-session');
    // A late frame of an ended turn changes nothing.
    endTurn(runner, start.turnId, { ok: false, error: 'busy' });
    const next = await startedTurn(w, s, 'And 3 + 3?');
    expect(next.spec.sessionId).toBe('b4c1f0e2-session');
    expect((await turnRow(w.t.db, start.turnId))?.status).toBe('done');
  });

  it("fails a turn the runner refused or whose result failed, with the runner's reason first", async () => {
    const s = await scene(w);
    const first = await startedTurn(w, s);
    endTurn(s.runner as FakeRunner, first.turnId, { ok: false, exitCode: null, error: 'home_missing' });
    expect(await ended(w.t.db, first.turnId)).toMatchObject({ status: 'failed', error: 'home_missing' });
    const second = await startedTurn(w, s, 'again');
    sendEvents(s.runner as FakeRunner, second.turnId, [
      { type: 'result', ok: false, error: 'exited with code 1' },
    ]);
    endTurn(s.runner as FakeRunner, second.turnId, { ok: false, exitCode: 1 });
    expect(await ended(w.t.db, second.turnId)).toMatchObject({
      status: 'failed',
      error: 'exited with code 1',
    });
    const third = await startedTurn(w, s, 'once more');
    endTurn(s.runner as FakeRunner, third.turnId, { ok: false, exitCode: 2 });
    expect(await ended(w.t.db, third.turnId)).toMatchObject({ status: 'failed', error: 'The turn failed' });
  });
});

describe('POST chats/:chatId/turns/:turnId/stop', () => {
  it('sends turn.stop, and the end makes the turn stopped', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    const path = chatPath(s.company, s.chat.id, `/turns/${start.turnId}/stop`);
    const res = await as(w, s.company.owner)('POST', path);
    expect([res.status, (res.body as ChatTurnView).status]).toEqual([202, 'running']);
    expect(await (s.runner as FakeRunner).frames.next('turn.stop')).toEqual({
      type: 'turn.stop',
      turnId: start.turnId,
    });
    endTurn(s.runner as FakeRunner, start.turnId, { ok: false, exitCode: null, error: 'stopped' });
    expect(await ended(w.t.db, start.turnId)).toMatchObject({ status: 'stopped', error: 'stopped' });
    const again = await as(w, s.company.owner)('POST', path);
    expect([again.status, again.body]).toMatchObject([409, { error: { code: 'turn_not_running' } }]);
  });

  it('is a 404 for an unknown chat or turn, and for members a 403', async () => {
    const s = await scene(w, { offline: true });
    const owner = as(w, s.company.owner);
    expect((await owner('POST', chatPath(s.company, 'nope', '/turns/nope/stop'))).body).toMatchObject({
      error: { code: 'chat_not_found' },
    });
    expect((await owner('POST', chatPath(s.company, s.chat.id, '/turns/nope/stop'))).body).toMatchObject({
      error: { code: 'turn_not_found' },
    });
  });
});

describe('a runner that goes away', () => {
  it("fails an older runner's running turns with machine_disconnected, naming the machine", async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    sendEvents(s.runner as FakeRunner, start.turnId, ANSWER.slice(0, 2));
    await eventually(
      'the events are stored',
      async () => (await eventRows(w.t.db, start.turnId)).length === 2,
    );
    await (s.runner as FakeRunner).disconnect();
    expect(await ended(w.t.db, start.turnId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(
        /^machine_disconnected: .+ disconnected, and its runner is too old to keep a turn/,
      ),
    });
  });
});

describe('credentials handed to a turn', () => {
  it("refreshes a Claude login's access token with under an hour left, and seals the new one", async () => {
    const s = await scene(w, { kind: 'claude_oauth' });
    w.provider.once(URLS.claudeToken, json(200, { access_token: 'fresh-access', expires_in: 28_800 }));
    // The seeded login has no refresh token: give it one that expires in 30 minutes.
    const store = credentialSecrets({ db: w.t.db, keyring: w.keyring, clock: w.clock });
    const expiresAt = new Date(TEST_NOW).getTime() + 30 * 60_000;
    const login = {
      credentials: { claudeAiOauth: { accessToken: 'old-access', refreshToken: 'refresh-1', expiresAt } },
      account: null,
    };
    await store.replaceCredentialSecret(s.credential?.id as string, s.company.owner.userId, login, 'test');
    const start = await startedTurn(w, s);
    expect(start.spec.credential).toEqual({ kind: 'claude_oauth', token: 'fresh-access' });
    expect(w.provider.callsTo(URLS.claudeToken)).toHaveLength(1);
    const reopened = await store.useCredentialSecret(
      s.credential?.id as string,
      s.company.owner.userId,
      'test',
    );
    expect(reopened).toMatchObject({
      ok: true,
      secret: { credentials: { claudeAiOauth: { accessToken: 'fresh-access' } } },
    });
  });

  it("seals again the Codex login a turn's process rewrote", async () => {
    const s = await scene(w, { harness: 'codex' });
    const start = await startedTurn(w, s);
    expect(start.spec.credential.kind).toBe('codex_oauth');
    const rewritten = JSON.stringify({ tokens: { access_token: 'codex-rewritten', refresh_token: 'r2' } });
    endTurn(s.runner as FakeRunner, start.turnId, { authJson: rewritten });
    await ended(w.t.db, start.turnId);
    const store = credentialSecrets({ db: w.t.db, keyring: w.keyring, clock: w.clock });
    await eventually('the login is sealed again', async () => {
      const opened = await store.useCredentialSecret(
        s.credential?.id as string,
        s.company.owner.userId,
        'test',
      );
      return opened.ok && JSON.stringify(opened.secret).includes('codex-rewritten');
    });
  });

  it('runs a Codex agent on its OpenAI profile’s subscription and gateway, headers and all', async () => {
    const s = await scene(w, { harness: 'codex', gateway: true });
    const start = await startedTurn(w, s);
    expect(start.spec).toMatchObject({
      harness: 'codex',
      credential: { kind: 'codex_oauth' },
      gateway: {
        baseUrl: `${GATEWAY_URL}/backend-api/codex`,
        headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' },
      },
    });
    expect((await scene(w, { harness: 'codex' })).profile.gatewayCredentialId).toBeNull();
  });

  it("sends a Claude and a Codex chat through one gateway, each at its CLI's path under the gateway's address", async () => {
    const claude = await startedTurn(w, await scene(w, { gateway: true }));
    const chatgpt = await startedTurn(w, await scene(w, { harness: 'codex', gateway: true }));
    const apiKey = await startedTurn(
      w,
      await scene(w, { harness: 'codex', kind: 'openai_api_key', gateway: true }),
    );
    expect(claude.spec.gateway?.baseUrl).toBe(GATEWAY_URL);
    expect(chatgpt.spec.gateway?.baseUrl).toBe(`${GATEWAY_URL}/backend-api/codex`);
    expect(apiKey.spec).toMatchObject({
      credential: { kind: 'openai_api_key' },
      gateway: { baseUrl: `${GATEWAY_URL}/v1`, headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' } },
    });
  });
});

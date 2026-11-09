import { TERMINAL_WS_PATH } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import type { TerminalTicketView } from '../../../../src/modules/machines/index.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  eventually,
  HOME,
  type Scene,
  scene,
  usesOf,
} from '../../../fixtures/chats/world.ts';
import { openTerminal, terminalUrl } from '../../../fixtures/machines/terminal.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const askTicket = (s: Scene, person: Person = s.company.owner) =>
  as(w, person)('POST', chatPath(s.company, s.chat.id, '/terminal-tickets'));

describe('POST chats/:chatId/terminal-tickets', () => {
  it("gives an owner the machine terminal's one-time ticket, and records the credential's use", async () => {
    const s = await scene(w);
    const res = await askTicket(s);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toMatchObject({ ticket: expect.stringMatching(/^mwc_tt_/), wsPath: TERMINAL_WS_PATH });
    expect((await usesOf(w.t.db, s.credential?.id as string)).map((use) => use.purpose)).toEqual([
      'chat_terminal',
    ]);
  });

  it('is for owners only, a 404 for an unknown chat, and refuses what a turn refuses or a runner without a PTY', async () => {
    const s = await scene(w, { caps: { terminal: false } });
    for (const role of ['admin', 'member'] as const) {
      expect((await askTicket(s, await addMember(w, s.company, role))).status).toBe(403);
    }
    const missing = await as(w, s.company.owner)('POST', chatPath(s.company, 'nope', '/terminal-tickets'));
    expect(missing.body).toMatchObject({ error: { code: 'chat_not_found' } });
    expect((await askTicket(s)).body).toMatchObject({ error: { code: 'terminal_unavailable' } });
    const offline = await scene(w, { offline: true });
    expect((await askTicket(offline)).body).toMatchObject({ error: { code: 'machine_offline' } });
    const archived = await scene(w);
    await as(w, archived.company.owner)('DELETE', chatPath(archived.company, archived.chat.id));
    expect((await askTicket(archived)).body).toMatchObject({ error: { code: 'chat_archived' } });
  });
});

describe("a chat's terminal socket", () => {
  it("opens the harness's TUI on the runner with the chat's spec, and relays it like the machine terminal", async () => {
    const s = await scene(w);
    const { ticket } = (await askTicket(s)).body as TerminalTicketView;
    const browser = await openTerminal(terminalUrl(w, { ticket, cols: 100, rows: 30 }));
    const runner = s.runner as FakeRunner;
    const open = await runner.frames.next('terminal.open');
    expect(open).toMatchObject({
      cols: 100,
      rows: 30,
      harness: {
        harness: 'claude_code',
        cwd: HOME,
        sessionId: null,
        model: 'claude-opus-5-5',
        permissionPolicy: 'ask',
        credential: { kind: 'claude_setup_token' },
        gateway: null,
      },
    });
    expect(open.harness).not.toHaveProperty('prompt');
    runner.send({ type: 'terminal.opened', sessionId: open.sessionId, shell: '/usr/local/bin/claude' });
    expect(await browser.next('opened')).toEqual({ type: 'opened', shell: '/usr/local/bin/claude' });
    runner.send({ type: 'terminal.exit', sessionId: open.sessionId, code: 0 });
    expect(await browser.next('exit')).toEqual({ type: 'exit', code: 0 });
  });

  it('seals again a Codex login the TUI rewrote, and never shows it to the browser', async () => {
    const s = await scene(w, { harness: 'codex' });
    const { ticket } = (await askTicket(s)).body as TerminalTicketView;
    const browser = await openTerminal(terminalUrl(w, { ticket, cols: 80, rows: 24 }));
    const runner = s.runner as FakeRunner;
    const open = await runner.frames.next('terminal.open');
    expect(open.harness?.credential.kind).toBe('codex_oauth');
    const authJson = JSON.stringify({ tokens: { access_token: 'codex-from-the-tui' } });
    runner.send({ type: 'terminal.exit', sessionId: open.sessionId, code: 0, authJson });
    const exit = await browser.next('exit');
    expect(exit).toEqual({ type: 'exit', code: 0 });
    expect(JSON.stringify(browser.messages)).not.toContain('codex-from-the-tui');
    const store = credentialSecrets({ db: w.t.db, keyring: w.keyring, clock: w.clock });
    await eventually('the login is sealed again', async () => {
      const opened = await store.useCredentialSecret(
        s.credential?.id as string,
        s.company.owner.userId,
        'test',
      );
      return opened.ok && JSON.stringify(opened.secret).includes('codex-from-the-tui');
    });
  });

  it("drops a rewritten login of a Claude chat's terminal: only a Codex login is sealed again", async () => {
    const s = await scene(w);
    const { ticket } = (await askTicket(s)).body as TerminalTicketView;
    const browser = await openTerminal(terminalUrl(w, { ticket, cols: 80, rows: 24 }));
    const open = await (s.runner as FakeRunner).frames.next('terminal.open');
    const authJson = JSON.stringify({ tokens: { access_token: 'not-for-claude' } });
    (s.runner as FakeRunner).send({ type: 'terminal.exit', sessionId: open.sessionId, code: 0, authJson });
    expect(await browser.next('exit')).toEqual({ type: 'exit', code: 0 });
  });
});

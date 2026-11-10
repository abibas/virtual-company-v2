import { memberships } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ChatsWorld,
  chatsWorld,
  ended,
  endTurn,
  place,
  scene,
  sendPrompt,
  startedTurn,
} from '../../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../../fixtures/members/members.ts';
import { putProfile, revokeSubscription, seedProfile } from '../../../../fixtures/org.ts';

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

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];

describe('POST chats/:chatId/turns refusals', () => {
  it('is for admins and owners, takes a prompt of 1 to 20 000 characters, and 404s an unknown chat', async () => {
    const s = await scene(w, { offline: true });
    for (const role of ['member', 'viewer'] as const) {
      expect((await sendPrompt(w, s, 'hi', await addMember(w, s.company, role))).status).toBe(403);
    }
    expect((await sendPrompt(w, s, '')).status).toBe(400);
    expect((await sendPrompt(w, s, 'p'.repeat(20_001))).status).toBe(400);
    const missing = await as(w, s.company.owner)(
      'POST',
      `/api/companies/${s.company.companyId}/chats/nope/turns`,
      {
        prompt: 'hi',
      },
    );
    expect(refusal(missing)).toEqual([404, 'chat_not_found']);
  });

  it('refuses a machine whose runner is offline, older than chats, or without the CLI', async () => {
    expect(refusal(await sendPrompt(w, await scene(w, { offline: true }), 'hi'))).toEqual([
      409,
      'machine_offline',
    ]);
    const old = await scene(w, { caps: { harnesses: ['claude_code'] } });
    expect(refusal(await sendPrompt(w, old, 'hi'))).toEqual([409, 'runner_outdated']);
    const noCodex = await scene(w, {
      harness: 'codex',
      caps: { harnesses: { claude_code: '2.1.319', codex: null } },
    });
    const res = await sendPrompt(w, noCodex, 'hi');
    expect(refusal(res)).toEqual([409, 'harness_missing']);
    expect((res.body as { error: { message: string } }).error.message).toContain('Codex');
  });

  it('refuses an agent without a placement, in a container, or whose harness changed', async () => {
    const s = await scene(w);
    const owner = as(w, s.company.owner);
    await place(w, s.company, s.agentId, { machineId: s.machineId, mode: 'container' });
    expect(refusal(await sendPrompt(w, s, 'hi'))).toEqual([409, 'container_runs_later']);
    await owner('DELETE', `/api/companies/${s.company.companyId}/agents/${s.agentId}/placement`);
    expect(refusal(await sendPrompt(w, s, 'hi'))).toEqual([409, 'placement_missing']);
    await place(w, s.company, s.agentId, { machineId: s.machineId });
    await owner('PATCH', `/api/companies/${s.company.companyId}/agents/${s.agentId}`, { harness: 'codex' });
    expect(refusal(await sendPrompt(w, s, 'hi'))).toEqual([409, 'harness_changed']);
  });

  it('refuses no profile, one without a subscription (naming it), and a subscription revoked', async () => {
    const s = await scene(w);
    const owner = as(w, s.company.owner);
    await owner('PATCH', `/api/companies/${s.company.companyId}/agents/${s.agentId}`, { profileId: null });
    expect(refusal(await sendPrompt(w, s, 'hi'))).toEqual([422, 'profile_missing']);
    const empty = await scene(w, { kind: null });
    const res = await sendPrompt(w, empty, 'hi');
    expect(refusal(res)).toEqual([422, 'profile_empty']);
    expect((res.body as { error: { message: string } }).error.message).toContain(empty.profile.name);
    const codex = await scene(w, { harness: 'codex', kind: null });
    expect(refusal(await sendPrompt(w, codex, 'hi'))).toEqual([422, 'profile_empty']);
    const revoked = await scene(w);
    await revokeSubscription(w.t.db, revoked.credential?.id as string);
    expect(refusal(await sendPrompt(w, revoked, 'hi'))).toEqual([422, 'credential_revoked']);
  });

  it("refuses a chat's own profile once the person who chose it is no longer an admin here", async () => {
    const s = await scene(w);
    const admin = await addMember(w, s.company, 'admin');
    const theirs = await seedProfile(w.t.db, admin.userId, { credentialId: null });
    await as(w, admin)('PATCH', `/api/companies/${s.company.companyId}/chats/${s.chat.id}`, {
      profileId: theirs.id,
    });
    expect(refusal(await sendPrompt(w, s, 'hi'))).toEqual([422, 'profile_empty']);
    await rawDb(w.t.db)
      .update(memberships)
      .set({ role: 'member' })
      .where(eq(memberships.id, admin.membershipId));
    const res = await sendPrompt(w, s, 'hi');
    expect(refusal(res)).toEqual([422, 'profile_missing']);
    expect((res.body as { error: { message: string } }).error.message).toContain('no longer an admin');
  });

  it('refuses a profile of another provider than the harness runs on, put there without the rules', async () => {
    const s = await scene(w, { harness: 'codex' });
    const claude = await seedProfile(w.t.db, s.company.owner.userId, { provider: 'claude' });
    await putProfile(w.t.db, s.company.companyId, s.agentId, claude.id);
    const res = await sendPrompt(w, s, 'hi');
    expect(refusal(res)).toEqual([422, 'profile_harness_mismatch']);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'A Codex agent needs an OpenAI profile; this access profile is for Claude',
    );
    expect(s.runner?.frames.of('turn.start')).toEqual([]);
  });

  it("refuses an agent's settings that cannot start a turn, naming the field", async () => {
    const s = await scene(w);
    await as(w, s.company.owner)('PATCH', `/api/companies/${s.company.companyId}/agents/${s.agentId}`, {
      model: 'claude opus',
    });
    const res = await sendPrompt(w, s, 'hi');
    expect(refusal(res)).toEqual([422, 'invalid_spec']);
    expect((res.body as { error: { message: string } }).error.message).toContain('model');
    expect(s.runner?.frames.of('turn.start')).toEqual([]);
  });

  it('refuses a second turn while one runs, and takes the next one once it ended', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    expect(refusal(await sendPrompt(w, s, 'and then?'))).toEqual([409, 'turn_running']);
    endTurn(s.runner as never, start.turnId);
    await ended(w.t.db, start.turnId);
    const next = await sendPrompt(w, s, 'and then?');
    expect([next.status, (next.body as { seq: number }).seq]).toEqual([202, 2]);
  });
});

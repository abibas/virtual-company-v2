import { chats, tenant } from '@mwc/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { turnsRepo } from '../../../../src/modules/chats/repo/turns.ts';
import { chatBus } from '../../../../src/modules/chats/service/bus.ts';
import { clearChat, compactRefusal } from '../../../../src/modules/chats/service/conversation.ts';
import { type ChatsWorld, chatsWorld, scene } from '../../../fixtures/chats/world.ts';

// What the routes cannot reach: a turn of the chat recorded at the same moment as its Clear (on Postgres, two
// transactions numbering the same turn), and the refusal rule on its own.

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await w.disconnectAll();
});
afterAll(() => w.close());

/** A chat with a session, its tenant and the Clear's deps. */
async function withSession() {
  const s = await scene(w, { offline: true });
  const t = await tenant(w.t.db, s.company.companyId);
  await t.update(chats, { sessionId: 'b4c1f0e2-session' }, eq(chats.id, s.chat.id));
  const deps = { live: { bus: chatBus() }, clock: w.clock };
  return { s, t, deps, caller: { principalId: s.company.owner.principalId } };
}

describe('clearChat', () => {
  it('refuses as turn_running when another turn took its number, and throws any other failure', async () => {
    const { s, t, deps, caller } = await withSession();
    const taken = Object.assign(new Error('duplicate key'), { code: '23505' });
    vi.spyOn(turnsRepo, 'insert').mockRejectedValueOnce(taken);
    expect(await clearChat(deps, t, caller, s.chat.id)).toMatchObject({ ok: false, code: 'turn_running' });
    vi.spyOn(turnsRepo, 'insert').mockRejectedValueOnce(new Error('disk full'));
    await expect(clearChat(deps, t, caller, s.chat.id)).rejects.toThrow('disk full');
    expect(await clearChat(deps, t, caller, s.chat.id)).toMatchObject({ ok: true, turn: { kind: 'clear' } });
  });
});

describe('compactRefusal', () => {
  it('refuses a chat without a session, and a Codex chat, and lets a Claude Code chat with one compact', () => {
    expect(compactRefusal({ sessionId: null, harness: 'claude_code' })).toMatchObject({
      code: 'nothing_to_compact',
    });
    expect(compactRefusal({ sessionId: 's', harness: 'codex' })).toMatchObject({
      code: 'compact_unsupported',
    });
    expect(compactRefusal({ sessionId: 's', harness: 'claude_code' })).toBeUndefined();
  });
});

/**
 * A long chat for the history tests (docs/harness.md "Reading a long chat"): turns written straight into the chat's
 * tenant, a minute apart from 2026-11-09 09:00 UTC, each message with a `text` event (and the events asked for), each
 * Clear as the Clear route records it; and the readers of the detail and the older turns' route.
 */
import { chatEvents, chatTurns, tenant } from '@mwc/db';
import type { TurnEvent } from '@mwc/shared/harness';
import type { ChatDetailView, ChatTurnWithEventsView } from '../../../src/modules/chats/schemas.ts';
import { as } from '../members/members.ts';
import type { ChatsWorld, Scene } from './world.ts';

/** One turn to write: a message (with extra events), or a Clear. */
export type SeedTurn = 'message' | 'clear' | { readonly events: readonly TurnEvent[] };

const START = Date.parse('2026-11-09T09:00:00.000Z');

/** The time of turn `seq`: a minute after the one before. */
export const turnAt = (seq: number) => new Date(START + (seq - 1) * 60_000).toISOString();

/** Writes the turns after the chat's last one (from turn 1 on an empty chat); returns their ids by number. */
export async function seedTurns(
  w: ChatsWorld,
  s: Pick<Scene, 'company' | 'chat'>,
  turns: readonly SeedTurn[],
  from = 1,
): Promise<string[]> {
  const t = await tenant(w.t.db, s.company.companyId);
  const ids: string[] = [];
  for (const [i, turn] of turns.entries()) {
    const seq = from + i;
    const at = new Date(turnAt(seq));
    const clear = turn === 'clear';
    const [row] = await t
      .insert(chatTurns, {
        chatId: s.chat.id,
        seq,
        kind: clear ? 'clear' : 'message',
        prompt: clear ? '/clear' : `Message ${seq}`,
        status: 'done',
        startedAt: at,
        endedAt: at,
        resultText: clear ? null : `Reply ${seq}`,
        createdBy: s.company.owner.principalId,
        createdAt: at,
      })
      .returning();
    const id = (row as { id: string }).id;
    ids.push(id);
    if (clear) continue;
    const extra = turn === 'message' ? [] : turn.events;
    const events: TurnEvent[] = [...extra, { type: 'text', text: `Reply ${seq}` }];
    await t.insert(
      chatEvents,
      events.map((event, n) => ({ turnId: id, seq: n + 1, event, at })),
    );
  }
  return ids;
}

/** `count` plain messages. */
export const messages = (count: number): SeedTurn[] => Array.from({ length: count }, () => 'message');

/** The chat's detail, as its owner reads it. */
export const detailOf = async (w: ChatsWorld, s: Pick<Scene, 'company' | 'chat'>) =>
  (await as(w, s.company.owner)('GET', `/api/companies/${s.company.companyId}/chats/${s.chat.id}`))
    .body as ChatDetailView;

/** The older turns' route with this query, as its owner (or `person`) reads it. */
export async function olderOf(
  w: ChatsWorld,
  s: Pick<Scene, 'company' | 'chat'>,
  query: string,
  person = s.company.owner,
) {
  const path = `/api/companies/${s.company.companyId}/chats/${s.chat.id}/turns?${query}`;
  const res = await as(w, person)('GET', path);
  return { status: res.status, body: res.body as { turns: ChatTurnWithEventsView[]; more: boolean } };
}

/** The turns' numbers. */
export const seqs = (turns: readonly { readonly seq: number }[]) => turns.map((turn) => turn.seq);

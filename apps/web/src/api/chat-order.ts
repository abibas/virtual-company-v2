import type { ChatListItem, ChatTurn } from './types.ts';

/**
 * The order of an agent's chat list (2026-11-14, Ihor: "sorted by running currently, then older"): the chats with a
 * turn that waits or runs first, the one started last on top; then the rest by their latest turn (when it ended, else
 * began), a chat without one by when it began; then by id.
 */

/** True while the turn waits (for the machine, a slot, the turn before) or runs. */
export const isLiveTurn = (turn: Pick<ChatTurn, 'status'> | null | undefined): boolean =>
  turn?.status === 'queued' || turn?.status === 'running';

type Ordered = Pick<ChatListItem, 'id' | 'createdAt' | 'lastTurn'>;

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

/** When a live chat's turn began (or was sent, while it waits). */
const startedAt = ({ lastTurn, createdAt }: Ordered) =>
  time(lastTurn ? (lastTurn.startedAt ?? lastTurn.createdAt) : createdAt);

/** When a chat last moved: its latest turn's end, else its start, else when the chat began. */
const movedAt = ({ lastTurn, createdAt }: Ordered) =>
  time(lastTurn ? (lastTurn.endedAt ?? lastTurn.startedAt ?? lastTurn.createdAt) : createdAt);

/** The list's order (see above), for `Array.prototype.sort`. */
export function chatOrder(a: Ordered, b: Ordered): number {
  const live = Number(isLiveTurn(b.lastTurn)) - Number(isLiveTurn(a.lastTurn));
  if (live !== 0) return live;
  const at = isLiveTurn(a.lastTurn) ? startedAt(b) - startedAt(a) : movedAt(b) - movedAt(a);
  return at || b.id.localeCompare(a.id);
}

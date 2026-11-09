import type { ChatStreamEvent, ChatTurn, ChatTurnWithEvents } from './types.ts';

/**
 * A chat's turns kept in step with its stream (S5.1c): a turn message replaces the turn's fields and keeps its events,
 * an event goes into its turn once, in order, a waiting message that went leaves (S5.2 step 6), and the last position
 * is what a reconnect sends as `Last-Event-ID`. Pure.
 */

/**
 * The turn with its new fields (status, reply, usage, and its number once a waiting one starts), its events kept; a new
 * turn in its place by number.
 */
export function upsertTurn(
  turns: readonly ChatTurnWithEvents[],
  turn: ChatTurn,
): readonly ChatTurnWithEvents[] {
  const index = turns.findIndex((known) => known.id === turn.id);
  const known = turns[index];
  const next = known
    ? turns.map((t, i) => (i === index ? { ...known, ...turn, events: known.events } : t))
    : [...turns, { ...turn, events: [] }];
  return next.sort((a, b) => a.seq - b.seq);
}

/** The turns without a waiting message that went (discarded, or taken into the running turn). */
export function removeTurn(
  turns: readonly ChatTurnWithEvents[],
  turnId: string,
): readonly ChatTurnWithEvents[] {
  return turns.some((turn) => turn.id === turnId) ? turns.filter((turn) => turn.id !== turnId) : turns;
}

/** The event added to its turn, in order of `seq`; one the turn has already, or of an unknown turn, changes nothing. */
export function addEvent(
  turns: readonly ChatTurnWithEvents[],
  message: ChatStreamEvent,
): readonly ChatTurnWithEvents[] {
  const index = turns.findIndex((known) => known.id === message.turnId);
  const turn = turns[index];
  if (turn === undefined || turn.events.some((event) => event.seq === message.seq)) return turns;
  const { turnId: _turnId, turnSeq: _turnSeq, ...event } = message;
  const events = [...turn.events, event].sort((a, b) => a.seq - b.seq);
  return turns.map((t, i) => (i === index ? { ...turn, events } : t));
}

/**
 * Where the chat stands, as the stream's ids say it (`<turnSeq>.<seq>`): the last turn that started and its last event
 * (a waiting one has none yet, and starts with a later number). With no turn yet it is `1.0`, so a turn begun before
 * the stream opened is replayed too.
 */
export function lastEventId(turns: readonly ChatTurnWithEvents[]): string {
  const last = turns.filter((turn) => turn.status !== 'queued').at(-1);
  if (last === undefined) return '1.0';
  return `${last.seq}.${last.events.at(-1)?.seq ?? 0}`;
}

/** A turn that runs or waits for its machine. */
export const isLiveTurn = (turn: Pick<ChatTurn, 'status'>): boolean =>
  turn.status === 'queued' || turn.status === 'running';

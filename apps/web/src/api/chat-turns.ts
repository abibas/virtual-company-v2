import type { ChatStreamEvent, ChatTurn, ChatTurnWithEvents } from './types.ts';

/**
 * A chat's turns kept in step with its stream (S5.1c): a turn message replaces the turn's fields and keeps its events,
 * an event goes into its turn once, in order, and the last position is what a reconnect sends as `Last-Event-ID`. Pure.
 */

/** The turn with its new fields (status, reply, usage), its events kept; a new turn in its place by number. */
export function upsertTurn(
  turns: readonly ChatTurnWithEvents[],
  turn: ChatTurn,
): readonly ChatTurnWithEvents[] {
  const index = turns.findIndex((known) => known.id === turn.id);
  if (index >= 0) {
    const known = turns[index] as ChatTurnWithEvents;
    return turns.map((t, i) => (i === index ? { ...known, ...turn, events: known.events } : t));
  }
  return [...turns, { ...turn, events: [] }].sort((a, b) => a.seq - b.seq);
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
 * Where the chat stands, as the stream's ids say it (`<turnSeq>.<seq>`): the last turn and its last event. With no
 * turn yet it is `1.0`, so a turn begun before the stream opened is replayed too.
 */
export function lastEventId(turns: readonly ChatTurnWithEvents[]): string {
  const last = turns.at(-1);
  if (last === undefined) return '1.0';
  return `${last.seq}.${last.events.at(-1)?.seq ?? 0}`;
}

/** A turn that runs or waits for its machine. */
export const isLiveTurn = (turn: Pick<ChatTurn, 'status'>): boolean =>
  turn.status === 'queued' || turn.status === 'running';

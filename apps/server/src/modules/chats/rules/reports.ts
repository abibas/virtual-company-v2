import type { ChatTurnKind, ChatTurnStatus } from '@mwc/shared/enums';

/**
 * The rail's Chats (docs/harness.md "Your direct reports in the rail"), pure: the first row per key of rows read latest
 * first, where a chat stands from its few standing turns, and the order of the reports (the Leads first, then by name).
 */

/** A turn as the standing read gives it. */
export interface StandingTurn {
  readonly id: string;
  readonly chatId: string;
  readonly seq: number;
  readonly kind: ChatTurnKind;
  readonly status: ChatTurnStatus;
  readonly system: boolean;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
}

/** Where a chat stands, before its question is read. */
export interface ChatStanding {
  /** The last turn's id, whose events may hold an open question. */
  readonly lastTurnId: string | null;
  readonly lastTurn: { readonly status: ChatTurnStatus; readonly at: Date } | null;
  readonly working: boolean;
  readonly replyAt: Date | null;
  readonly messageAt: Date | null;
}

/** The first row of each key, of rows already ordered latest first. */
export function firstBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const row of rows) if (!out.has(key(row))) out.set(key(row), row);
  return out;
}

/** The last time a turn changed: its end, else its start, else when it was written. */
const changedAt = (turn: StandingTurn): Date => turn.endedAt ?? turn.startedAt ?? turn.createdAt;

const highest = (turns: readonly StandingTurn[]): StandingTurn | undefined =>
  turns.reduce<StandingTurn | undefined>((top, turn) => (top && top.seq > turn.seq ? top : turn), undefined);

/**
 * Where a chat stands from its standing turns (any order): its last turn and when it changed, whether one runs, when its
 * latest reply ended (a message turn that is done) and when `viewer` last wrote in it (a message of theirs, not one
 * Most Wanted queued).
 */
export function chatStanding(turns: readonly StandingTurn[], viewer: string): ChatStanding {
  const last = highest(turns);
  const reply = highest(turns.filter((turn) => turn.kind === 'message' && turn.status === 'done'));
  const mine = highest(
    turns.filter((turn) => turn.kind === 'message' && !turn.system && turn.createdBy === viewer),
  );
  return {
    lastTurnId: last?.id ?? null,
    lastTurn: last ? { status: last.status, at: changedAt(last) } : null,
    working: turns.some((turn) => turn.status === 'running'),
    replyAt: reply ? changedAt(reply) : null,
    messageAt: mine?.createdAt ?? null,
  };
}

/** The Leads first, then by name (case and accents aside), then by id. */
export function reportOrder(
  a: { readonly lead: boolean; readonly name: string; readonly id: string },
  b: { readonly lead: boolean; readonly name: string; readonly id: string },
): number {
  if (a.lead !== b.lead) return a.lead ? -1 : 1;
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

import type { Chat, ChatEvent, ChatTurn } from '@mwc/db';
import type { TurnEvent } from '@mwc/shared/harness';
import type { ChatEventView, ChatStreamEvent, ChatTurnView, ChatView } from '../schemas.ts';

/** Chats, turns and events as the API and the stream show them: never a secret (a turn names its credential's id). */

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function chatView(row: Chat): ChatView {
  return {
    id: row.id,
    agentId: row.agentId,
    harness: row.harness,
    machineId: row.machineId,
    profileId: row.profileId,
    profileSetBy: row.profileId === null ? null : row.profileSetBy,
    sessionId: row.sessionId,
    title: row.title,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
  };
}

export function turnView(row: ChatTurn): ChatTurnView {
  return {
    id: row.id,
    chatId: row.chatId,
    seq: row.seq,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    delivery: row.delivery,
    profileId: row.profileId,
    credentialId: row.credentialId,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    resultText: row.resultText,
    error: row.error,
    usage: row.usage,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function eventView(row: ChatEvent): ChatEventView {
  return { seq: row.seq, event: row.event as TurnEvent, at: row.at.toISOString() };
}

/** An event as the stream sends it: with its turn's id and number. */
export function streamEvent(turn: Pick<ChatTurn, 'id' | 'seq'>, row: ChatEvent): ChatStreamEvent {
  return { turnId: turn.id, turnSeq: turn.seq, ...eventView(row) };
}

import type { Decision } from '@mwc/db';
import type { DecisionApiView } from './schemas.ts';

/** The decision log's pure rules (2026-11-14): a row as the API reads it, and the tool's answer. */

/** A stored decision as the API, the chat's stream and the pages read it. */
export const decisionView = (row: Decision): DecisionApiView => ({
  id: row.id,
  agentId: row.agentId,
  chatId: row.chatId,
  turnId: row.turnId,
  taskId: row.taskId,
  contactId: row.contactId,
  what: row.what,
  why: row.why,
  sources: [...row.sources],
  outcome: row.outcome,
  eventSeq: row.eventSeq,
  createdAt: row.createdAt.toISOString(),
});

/** What the tool answers once the decision is kept. */
export const recordedAnswer = (what: string): string =>
  `Recorded your decision "${what}" with your reasons and sources.`;

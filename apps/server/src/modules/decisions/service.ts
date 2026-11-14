import { auditChanges, diffFields, type TenantDb } from '@mwc/db';
import { checkToolInput } from '@mwc/shared/flows';
import type { DecisionRecorded, DecisionsHook, DecisionTurn } from '../chats/index.ts';
import { decisionsRepo } from './repo.ts';
import { decisionView, recordedAnswer } from './rules.ts';
import { DECISION_PAGE, type DecisionList, type DecisionListQuery } from './schemas.ts';

/**
 * The decision log (2026-11-14, docs/processes.md "Decisions"): a `record_decision` call checked again (whatever the
 * runner checked) and kept with its turn, chat, agent, task and contact, audited as the agent with its turn as the
 * request; and the company's decisions read back, newest first, by agent, chat, task, contact and outcome.
 */

const repo = decisionsRepo;

/** Fields an audit row of a decision never carries. */
const AUDIT_IGNORED = ['companyId', 'id', 'createdAt'];

/** Keeps the turn's decision; a bad input is a tool error saying what to fix, and nothing is kept. */
export async function recordDecision(
  clock: () => Date,
  t: TenantDb,
  turn: DecisionTurn,
  input: unknown,
): Promise<DecisionRecorded> {
  const checked = checkToolInput('record_decision', input);
  if (!checked.ok) return { reply: { ok: false, text: checked.error } };
  const { what, why, sources, outcome } = checked.input;
  const row = await t.transaction(async (tx) => {
    const made = await repo.insert(tx, {
      agentId: turn.agentId,
      chatId: turn.chatId,
      turnId: turn.turnId,
      taskId: turn.taskId,
      contactId: turn.contactId,
      what,
      why,
      sources: sources ?? [],
      outcome: outcome ?? null,
      eventSeq: turn.eventSeq,
      createdAt: clock(),
    });
    await auditChanges(tx, {
      actorKind: 'agent',
      actorPrincipalId: turn.agentPrincipalId,
      requestId: turn.turnId,
      entityType: 'decision',
      entityId: made.id,
      action: 'record',
      changes: diffFields(undefined, made, { ignore: AUDIT_IGNORED }),
    });
    return made;
  });
  return { reply: { ok: true, text: recordedAnswer(row.what) }, decision: decisionView(row) };
}

/** The decisions module's side of the chats' turns, which `app.ts` passes to the chats module. */
export const decisionsHook = (deps: { readonly clock: () => Date }): DecisionsHook => ({
  record: (t, turn, input) => recordDecision(deps.clock, t, turn, input),
});

/** A page of the company's decisions (see above); undefined when `before` names no decision of the company. */
export async function listDecisions(
  t: TenantDb,
  query: DecisionListQuery,
): Promise<DecisionList | undefined> {
  const before = query.before === undefined ? undefined : await repo.get(t, query.before);
  if (query.before !== undefined && before === undefined) return undefined;
  const limit = query.limit ?? DECISION_PAGE.default;
  const rows = await repo.list(t, {
    agentId: query.agent,
    chatId: query.chat,
    taskId: query.task,
    contactId: query.contact,
    outcome: query.outcome,
    before,
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    decisions: page.map(decisionView),
    nextBefore: rows.length > limit && last !== undefined ? last.id : null,
  };
}

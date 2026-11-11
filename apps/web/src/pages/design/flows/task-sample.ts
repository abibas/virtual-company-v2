import type { TaskAction, TaskState } from '@mwc/shared/enums';
import type { BoardColumn, Flow, TaskDetail, TaskEvent } from '../../../api/flows.ts';
import { sampleArtifacts } from './artifact-sample.ts';
import { sampleConversations } from './conversation-sample.ts';
import { ago, DESIGN, DEVBOX, ref, sampleBoard } from './flow-sample.ts';
import { type EventSpec, HISTORIES, LIMIT_REASON } from './task-history-sample.ts';

/**
 * The gallery's tasks, as `GET /tasks/:key` would answer them for the owner: T-12 waiting for Ihor's sign-off after
 * three rounds (a failed first turn, send-backs from Code review and QA; with its steps' conversations and artifacts), T-14 escalated over Code review's limit,
 * T-18 working (its turn running, its hand-on recorded), T-17 ended without a hand-off, T-15 blocked at QA, and every other card of the sample
 * boards with a short history of its own.
 */

const DESCRIPTION = `Safari drops the session cookie after the redirect from the sign-in page, so the person lands on
the sign-in page again.

- Set \`SameSite=Lax\` on the session cookie
- Keep the \`redirect_url\` through the round trip
- Add a test for the Safari path in \`auth.test.ts\`

Reproduce: sign out, open \`/most-wanted/flows\` in Safari 19, sign in.`;

const stepOf = (flow: Flow, id: string) => {
  const step = flow.steps.find((s) => s.id === id);
  if (!step) throw new Error(`No sample step ${id}`);
  return step;
};

const historyOf = (flow: Flow, specs: readonly EventSpec[]): TaskEvent[] =>
  specs.map(([kind, actor, from, to, minutes, extra], index) => ({
    id: `e-${index}`,
    kind,
    actor: actor ? ref(actor) : null,
    from: from ? { id: from, name: stepOf(flow, from).name } : null,
    to: to ? { id: to, name: stepOf(flow, to).name } : null,
    round: extra?.round ?? null,
    reason: extra?.reason ?? null,
    details: kind === 'edited' ? { fields: ['description'] } : {},
    at: ago(minutes),
  }));

/** Each step's entries and send-backs, counted from the history as the server keeps them. */
const roundsOf = (flow: Flow, history: readonly TaskEvent[]) =>
  flow.steps.map((step) => ({
    step,
    entries: history.filter((e) => e.kind === 'entered' && e.to?.id === step.id).length,
    sendBacks: history.filter((e) => e.kind === 'sent_back' && e.from?.id === step.id).length,
  }));

/** The moves the owner may make on a task as it stands (the API's `actions`). */
function actionsOf(state: TaskState, column: BoardColumn): TaskAction[] {
  if (state === 'queued') return ['route', 'cancel'];
  if (state === 'escalated') return ['route', 'retry', 'cancel'];
  if (state !== 'active' || !column.step) return [];
  const card = column.cards[0];
  const start: TaskAction[] =
    card && card.stepState !== 'working' && card.stepState !== 'needs_person' ? ['start'] : [];
  const outcome: Record<string, TaskAction[]> = {
    work: ['hand_on'],
    check: ['pass', 'send_back'],
    signoff: ['approve', 'send_back'],
  };
  return [...start, ...(outcome[column.step.kind] ?? []), 'route', 'cancel'];
}

const STATE_OF: Readonly<Record<BoardColumn['kind'], TaskState>> = {
  queued: 'queued',
  step: 'active',
  done: 'done',
  escalated: 'escalated',
};

/** A sample task by its key, from the sample boards; undefined for a key on none. */
export function sampleTask(key: string): TaskDetail | undefined {
  for (const flow of [DEVBOX, DESIGN]) {
    const columns = sampleBoard(flow.id).columns;
    const column = columns.find((c) => c.cards.some((card) => card.key === key));
    const card = column?.cards.find((c) => c.key === key);
    if (!column || !card) continue;
    const state = STATE_OF[column.kind];
    const step = card.stepId ? stepOf(flow, card.stepId) : null;
    const at = step ? flow.steps.indexOf(step) : -1;
    const specs: readonly EventSpec[] = HISTORIES[key] ?? [['created', 'p-1', null, null, 60 * 30]];
    const history = historyOf(flow, specs);
    const rounds = history.some((e) => e.kind === 'entered')
      ? roundsOf(flow, history)
      : flow.steps
          .slice(0, at + 1)
          .map((s, i) => ({ step: s, entries: i === at ? (card.round ?? 1) : 1, sendBacks: 0 }));
    return {
      id: card.id,
      key: card.key,
      number: Number(key.slice(2)),
      flowId: flow.id,
      title: card.title,
      priority: card.priority,
      state,
      step: step ? { id: step.id, name: step.name, kind: step.kind } : null,
      stepState: card.stepState,
      blockedReason: card.blockedReason,
      round: card.round,
      assignee: card.assignee,
      createdBy: ref(specs[0]?.[1] ?? 'p-1'),
      createdAt: ago(specs[0]?.[4] ?? 60),
      updatedAt: card.updatedAt,
      closedAt: state === 'done' ? card.updatedAt : null,
      description: key === 'T-12' ? DESCRIPTION : '',
      flow: { id: flow.id, name: flow.name, lead: flow.lead },
      rounds: rounds.flatMap((r) =>
        r.entries > 0 ? [{ ...r, step: { id: r.step.id, name: r.step.name, kind: r.step.kind } }] : [],
      ),
      escalation:
        state === 'escalated'
          ? {
              reason: `Code review sent it back 3 times already, its limit; this time: ${LIMIT_REASON}`,
              retryTo: { id: 's-dev', name: 'Develop', kind: 'work' },
            }
          : null,
      history,
      actions: actionsOf(state, { ...column, cards: [card] }),
      conversations: sampleConversations(key),
      artifacts: sampleArtifacts(key).filter((a) => a.kind !== 'skipped').length,
      // T-18's running turn recorded its hand-on (S6a): the page says what happens when the turn ends.
      decision:
        key === 'T-18' && card.assignee
          ? {
              action: 'hand_on' as const,
              outcome: 'moved' as const,
              to: { id: 's-review', name: 'Code review' },
              reason: null,
              by: card.assignee,
              at: ago(2),
            }
          : null,
    };
  }
  return undefined;
}

/** The sample flow a task is in. */
export const sampleFlowOf = (task: TaskDetail): Flow => (task.flowId === DESIGN.id ? DESIGN : DEVBOX);

import type { TaskDetail } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Notice } from '../../../components/ui/Notice.tsx';
import { Face } from '../Face.tsx';

type Decision = NonNullable<TaskDetail['decision']>;

const ACTION_WORDS: Readonly<Record<Decision['action'], string>> = {
  hand_on: 'hand on',
  pass: 'pass it',
  approve: 'approve it',
  send_back: 'send it back',
  blocked: 'mark it blocked',
};

/** What the decision makes, in words: "Developer will hand on to Code review". */
export function decisionWords(decision: Decision): string {
  const who = decision.by.name;
  const action = ACTION_WORDS[decision.action];
  if (decision.outcome === 'blocked') return `${who} will mark it blocked`;
  if (decision.outcome === 'done') return `${who} will ${action}: the task is then done`;
  if (decision.outcome === 'escalated') return `${who} will send it back over the limit: it goes to the Lead`;
  return `${who} will ${action} to ${decision.to?.name ?? 'the next step'}`;
}

/**
 * The decision the step's agent recorded with its tools while its turn runs (S6a): what happens when the turn ends,
 * with the agent's face, and a send-back's or a block's reason under it. Nothing without one.
 */
export function TaskDecision({
  task,
  nodes,
}: {
  readonly task: TaskDetail;
  readonly nodes: ReadonlyMap<string, ChartNode>;
}) {
  const { decision } = task;
  if (!decision) return null;
  return (
    <Notice tone="info" title={decisionWords(decision)}>
      <span className="inline-flex items-center gap-1.5">
        <Face who={decision.by} nodes={nodes} />
        <span>When its turn ends.</span>
      </span>
      {decision.reason && <p className="mt-1 whitespace-pre-wrap">{decision.reason}</p>}
    </Notice>
  );
}

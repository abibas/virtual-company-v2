import { TASK_TITLE } from '@mwc/shared/flows';
import { roleAtLeast } from '@mwc/shared/roles';
import { useMemo } from 'react';
import type { Flow, FlowCalls, TaskDetail } from '../../../api/flows.ts';
import type { OrgChart } from '../../../api/types.ts';
import { InlineEdit } from '../../../components/forms/InlineEdit.tsx';
import { Breadcrumbs } from '../../../components/layout/Breadcrumbs.tsx';
import { nodesById } from '../../../components/org/chart.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { leadsTeam, myPrincipal, type Viewer } from '../access.ts';
import { drawnSteps, FlowDrawing } from '../drawing/FlowDrawing.tsx';
import { type FlowLinks, leadAddress } from '../links.ts';
import { Clip } from '../story/Clip.tsx';
import { flowCrumbs } from '../team/TeamHeader.tsx';
import { stepStateLook, TASK_STATE } from '../words.ts';
import type { TaskRuns } from './runs.ts';
import { TaskActions } from './TaskActions.tsx';
import { TaskDecision } from './TaskDecision.tsx';
import { TaskFacts } from './TaskFacts.tsx';
import { TaskTabs } from './TaskTabs.tsx';

export interface TaskViewProps {
  readonly task: TaskDetail;
  /** Its flow, for the drawing; undefined while it loads. */
  readonly flow: Flow | null | undefined;
  readonly chart: OrgChart;
  readonly viewer: Viewer;
  readonly links: FlowLinks;
  readonly calls: FlowCalls;
  /** Its steps' conversations' threads and its artifacts (S5.3b). */
  readonly runs: TaskRuns;
  /** The task moved or changed: read it again. */
  readonly onChanged: () => void;
  /** Its agents' recorded decisions, for members and above (2026-11-14): the company they are read from. */
  readonly decisions?: { readonly companyId: string } | undefined;
}

/** The rounds under each step it entered: "2 rounds · 1 sent back". */
function roundNotes(task: TaskDetail): ReadonlyMap<string, string> {
  return new Map(
    task.rounds.map(({ step, entries, sendBacks }) => [
      step.id,
      `${entries} ${entries === 1 ? 'round' : 'rounds'}${sendBacks > 0 ? ` · ${sendBacks} sent back` : ''}`,
    ]),
  );
}

/** The title, editable in place by those who may, with its key, state and step state beside it. */
function TitleRow({ props, editable }: { readonly props: TaskViewProps; readonly editable: boolean }) {
  const { task, calls, onChanged } = props;
  const state = TASK_STATE[task.state];
  const step = task.stepState
    ? stepStateLook(task.stepState, task.assignee?.principalId === myPrincipal(props.viewer))
    : undefined;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="font-mono text-sm font-bold text-dim">{task.key}</span>
      <h1 className="min-w-0 text-xl font-extrabold tracking-[-0.02em] text-ink">
        <InlineEdit
          value={task.title}
          label="Rename the task"
          maxLength={TASK_TITLE.max}
          disabled={!editable}
          onSave={(title) => calls.editTask(task.key, { title }).then(onChanged)}
        />
      </h1>
      <Badge tone={state.tone} dot>
        {state.label}
      </Badge>
      {step && <Badge tone={step.tone}>{step.label}</Badge>}
    </div>
  );
}

/** Why an escalated task is with the Lead, and where Retry sends it. */
function Escalation({ task }: { readonly task: TaskDetail }) {
  const { escalation } = task;
  if (!escalation) return null;
  const retry = escalation.retryTo ? `; Retry goes to ${escalation.retryTo.name}` : '';
  return (
    <Notice tone="warning" title={`With the Lead${retry}`}>
      <Clip text={escalation.reason} lines={2} />
    </Notice>
  );
}

/**
 * Why the task is blocked at its step: its turn could not start, or failed (S5.3b), or its agent said it cannot go on
 * (S6a, `task_blocked`: the block's history row names the agent).
 */
function Blocked({ task }: { readonly task: TaskDetail }) {
  if (task.stepState !== 'blocked' || !task.blockedReason) return null;
  const last = task.history.findLast((event) => event.kind === 'blocked');
  const by = last?.actor?.kind === 'agent' ? ` · reported by ${last.actor.name}` : '';
  return (
    <Notice tone="error" title={`Blocked at ${task.step?.name ?? 'its step'}${by}`}>
      <Clip text={task.blockedReason} lines={2} />
    </Notice>
  );
}

/**
 * A task's page (`/:slug/tasks/T-12`): the path, its title and where it stands; why it is escalated or blocked, the
 * decision its running turn recorded; its moves (the caller's own) and its flow drawn with its step ringed and its rounds
 * under each step. Under them the tabs (its story by round, its conversations, its description, its full log); beside
 * them its facts (above the tabs on a phone). The company's route and the design gallery both render it.
 */
export function TaskView(props: TaskViewProps) {
  const { task, flow, chart, viewer, links, calls, runs, onChanged } = props;
  const nodes = useMemo(() => nodesById(chart.nodes), [chart]);
  const leads = leadsTeam(viewer, task.flow.lead.principalId);
  const editable =
    roleAtLeast(viewer.role, 'member') && (leads || task.createdBy.principalId === myPrincipal(viewer));
  const teamHref = links.team(leadAddress(task.flow.lead));
  const here = task.state === 'done' ? 'done' : (task.step?.id ?? undefined);
  return (
    <>
      <Breadcrumbs
        className="mb-2"
        items={flowCrumbs(links, { label: task.flow.name, href: teamHref }, { label: task.key })}
      />
      <TitleRow props={props} editable={editable} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-3 lg:col-start-1">
          <Escalation task={task} />
          <Blocked task={task} />
          <TaskDecision task={task} nodes={nodes} />
          {task.actions.length > 0 && (
            <Card padding="sm">
              <TaskActions task={task} flow={flow} calls={calls} onMoved={onChanged} />
            </Card>
          )}
          {flow && (
            <Card padding="sm">
              <FlowDrawing steps={drawnSteps(flow)} nodes={nodes} here={here} notes={roundNotes(task)} />
            </Card>
          )}
        </div>
        <Card padding="sm" className="min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <TaskFacts
            task={task}
            nodes={nodes}
            teamHref={teamHref}
            editable={editable}
            onPriority={(priority) => calls.editTask(task.key, { priority }).then(onChanged)}
          />
        </Card>
        <div className="min-w-0 lg:col-start-1">
          <TaskTabs
            task={task}
            flow={flow}
            nodes={nodes}
            runs={runs}
            editable={editable}
            me={myPrincipal(viewer)}
            decisions={props.decisions}
            onDescription={(description) => calls.editTask(task.key, { description }).then(onChanged)}
          />
        </div>
      </div>
    </>
  );
}

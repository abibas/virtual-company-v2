import { TASK_TITLE } from '@mwc/shared/flows';
import { roleAtLeast } from '@mwc/shared/roles';
import { type ReactNode, useMemo } from 'react';
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
import { flowCrumbs } from '../team/TeamHeader.tsx';
import { stepStateLook, TASK_STATE } from '../words.ts';
import { TaskActions } from './TaskActions.tsx';
import { TaskDescription } from './TaskDescription.tsx';
import { TaskFacts } from './TaskFacts.tsx';
import { TaskHistory } from './TaskHistory.tsx';

export interface TaskViewProps {
  readonly task: TaskDetail;
  /** Its flow, for the drawing; undefined while it loads. */
  readonly flow: Flow | null | undefined;
  readonly chart: OrgChart;
  readonly viewer: Viewer;
  readonly links: FlowLinks;
  readonly calls: FlowCalls;
  /** The task moved or changed: read it again. */
  readonly onChanged: () => void;
}

/** A part of the page with a small heading. */
function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card as="section" padding="sm" aria-label={title}>
      <h2 className="mb-2.5 text-xs font-bold tracking-wide text-dim uppercase">{title}</h2>
      {children}
    </Card>
  );
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
      {escalation.reason}
    </Notice>
  );
}

/**
 * A task's page (`/:slug/tasks/T-12`): the path, its title and where it stands; its moves (the caller's own), its
 * flow drawn with its step ringed and its rounds under each step, its description; beside them its facts and its
 * history. The company's route and the design gallery both render it.
 */
export function TaskView(props: TaskViewProps) {
  const { task, flow, chart, viewer, links, calls, onChanged } = props;
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Escalation task={task} />
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
          <Part title="Description">
            <TaskDescription
              value={task.description}
              editable={editable}
              onSave={(description) => calls.editTask(task.key, { description }).then(onChanged)}
            />
          </Part>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card padding="sm">
            <TaskFacts
              task={task}
              nodes={nodes}
              teamHref={teamHref}
              editable={editable}
              onPriority={(priority) => calls.editTask(task.key, { priority }).then(onChanged)}
            />
          </Card>
          <Part title="History">
            <TaskHistory history={task.history} />
          </Part>
        </div>
      </div>
    </>
  );
}

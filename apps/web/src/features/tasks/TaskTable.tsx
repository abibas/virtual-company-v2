import type { TaskRow } from '../../api/tasks.ts';
import type { ChartNode } from '../../api/types.ts';
import { Link } from '../../app/router.tsx';
import { type Column, DataTable } from '../../components/data/DataTable.tsx';
import { Face, Who } from '../flows/Face.tsx';
import { PriorityMark, StatePill, StepChip, Updated } from './TaskRowParts.tsx';

/** What a row needs beside the task: its flow's name, the chart's faces, the viewer and the task's page. */
export interface TaskTableContext {
  readonly flowName: (flowId: string) => string;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The viewer's principal: a task waiting for them "Needs you". */
  readonly me: string | undefined;
  readonly href: (key: string) => string;
}

/** Its round at its step; a dash when it is at none. */
const roundText = (task: TaskRow) => (task.round === null ? '—' : String(task.round));

/** The first cell: the key and the title (the row's link); on phones, where it stands and who has it under them. */
function TaskCell({ task, ctx }: { readonly task: TaskRow; readonly ctx: TaskTableContext }) {
  const mine = task.assignee !== null && task.assignee.principalId === ctx.me;
  return (
    <div className="min-w-0">
      <Link
        to={ctx.href(task.key)}
        className="flex min-w-0 items-baseline gap-2 rounded-xs focus-visible:text-teal hover:text-teal"
      >
        <span className="shrink-0 font-mono text-xs font-bold text-dim">{task.key}</span>
        <span className="min-w-0 font-semibold wrap-anywhere text-ink">{task.title}</span>
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim md:hidden">
        <StatePill task={task} mine={mine} />
        <StepChip step={task.step} />
        {task.priority !== 'normal' && <PriorityMark priority={task.priority} />}
        {task.round !== null && task.round > 1 && <span>round {task.round}</span>}
        <span className="min-w-0 truncate">{ctx.flowName(task.flowId)}</span>
        {task.assignee && (
          <span title={task.assignee.name} className="ml-auto">
            <Face who={task.assignee} nodes={ctx.nodes} />
          </span>
        )}
      </div>
    </div>
  );
}

function taskColumns(ctx: TaskTableContext): readonly Column<TaskRow>[] {
  const mine = (task: TaskRow) => task.assignee !== null && task.assignee.principalId === ctx.me;
  return [
    { key: 'task', header: 'Task', cell: (task) => <TaskCell task={task} ctx={ctx} /> },
    {
      key: 'flow',
      header: 'Flow',
      hide: 'lg',
      className: 'whitespace-nowrap',
      cell: (task) => ctx.flowName(task.flowId),
    },
    { key: 'step', header: 'Step', hide: 'md', cell: (task) => <StepChip step={task.step} /> },
    {
      key: 'who',
      header: 'Who',
      hide: 'md',
      cell: (task) =>
        task.assignee ? (
          <Who who={task.assignee} nodes={ctx.nodes} className="max-w-40" />
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: 'state',
      header: 'State',
      hide: 'md',
      cell: (task) => <StatePill task={task} mine={mine(task)} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      hide: 'lg',
      cell: (task) => <PriorityMark priority={task.priority} />,
    },
    { key: 'round', header: 'Round', hide: 'lg', className: 'tabular text-dim', cell: roundText },
    {
      key: 'updated',
      header: 'Updated',
      align: 'right',
      cell: (task) => <Updated at={task.updatedAt} />,
    },
  ];
}

/** Every task of the list as a row of the table; a click on a row opens the task. */
export function TaskTable({
  rows,
  ctx,
}: {
  readonly rows: readonly TaskRow[];
  readonly ctx: TaskTableContext;
}) {
  return (
    <DataTable
      columns={taskColumns(ctx)}
      rows={rows}
      rowKey={(task) => task.id}
      rowHref={(task) => ctx.href(task.key)}
    />
  );
}

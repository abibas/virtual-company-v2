import { CalendarRange } from 'lucide-react';
import type { Sprint, SprintSummary } from '../../../api/flows.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { LoadState } from '../../../components/data/LoadState.tsx';
import { CopyButton } from '../../../components/forms/CopyButton.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import type { FlowLinks } from '../links.ts';
import { PRIORITY } from '../words.ts';
import { sprintMarkdown, sprintMoment } from './words.ts';

/** "12 done · 2 cancelled · 3 carried over". */
const countsLine = (sprint: SprintSummary) =>
  `${sprint.done} done · ${sprint.cancelled} cancelled · ${sprint.carriedOver} ${sprint.current ? 'open' : 'carried over'}`;

/** One sprint in the list: its name, when it started and ended and by whom, and its counts. */
function SprintRow({
  sprint,
  selected,
  onSelect,
}: {
  readonly sprint: SprintSummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-surface-3' : 'hover:bg-surface-2',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{sprint.name}</span>
        {sprint.current && (
          <Badge tone="blue" size="sm" dot>
            Current
          </Badge>
        )}
      </span>
      <span className="text-xs text-dim">
        Started {sprintMoment(sprint.startedAt)} by {sprint.startedBy.name}
      </span>
      <span className="text-xs text-dim">
        {sprint.endedAt
          ? `Ended ${sprintMoment(sprint.endedAt)}${sprint.endedBy ? ` by ${sprint.endedBy.name}` : ''}`
          : 'Running'}
      </span>
      <span className="text-xs text-ink-2">{countsLine(sprint)}</span>
    </button>
  );
}

type ReportTask = { readonly key: string; readonly title: string };

/** One part of the report: its title and count, then its tasks, each linking to the task. */
function ReportPart<T extends ReportTask>({
  title,
  tasks,
  links,
  detail,
}: {
  readonly title: string;
  readonly tasks: readonly T[];
  readonly links: FlowLinks;
  readonly detail: (task: T) => string;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-dim uppercase">
        {title} ({tasks.length})
      </h3>
      {tasks.length === 0 ? (
        <p className="text-sm text-dim">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => (
            <li key={task.key} className="flex min-w-0 items-baseline gap-2 text-sm">
              <Link to={links.task(task.key)} className="shrink-0 font-mono text-xs font-semibold text-blue">
                {task.key}
              </Link>
              <Link to={links.task(task.key)} className="min-w-0 flex-1 truncate text-ink hover:underline">
                {task.title}
              </Link>
              <span className="shrink-0 text-xs text-dim">{detail(task)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ClosedTask = Sprint['report']['done'][number];

const closedDetail = (task: ClosedTask) =>
  `${task.priority === 'normal' ? '' : `${PRIORITY[task.priority].label} · `}${sprintMoment(task.closedAt)}`;

/** A sprint's report: Done, Cancelled, Carried over (each linking to the task), how many were made, and Copy report. */
export function SprintReportCard({
  sprint,
  flowName,
  links,
}: {
  readonly sprint: Sprint;
  readonly flowName: string;
  readonly links: FlowLinks;
}) {
  const { report } = sprint;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{sprint.name}</h2>
          <p className="text-xs text-dim">
            {sprintMoment(sprint.startedAt)} → {sprint.endedAt ? sprintMoment(sprint.endedAt) : 'now'}
            {sprint.current ? ' · the report so far' : ''}
          </p>
        </div>
        <CopyButton text={sprintMarkdown(sprint, flowName)} label="Copy report" />
      </div>
      <ReportPart title="Done" tasks={report.done} links={links} detail={closedDetail} />
      <ReportPart title="Cancelled" tasks={report.cancelled} links={links} detail={closedDetail} />
      <ReportPart
        title={sprint.current ? 'Open now (would carry over)' : 'Carried over'}
        tasks={report.carriedOver}
        links={links}
        detail={(task) => task.where}
      />
      <p className="text-sm text-ink-2">Created in it: {report.created}</p>
    </Card>
  );
}

/**
 * The Sprints tab (T-37): the flow's sprints, the newest first, and the one chosen with its report (the current one's
 * so far, live).
 */
export function SprintsView({
  sprints,
  selected,
  onSelect,
  report,
  flowName,
  links,
}: {
  readonly sprints: readonly SprintSummary[];
  readonly selected: string | undefined;
  readonly onSelect: (sprintId: string) => void;
  readonly report: Loaded<Sprint> | undefined;
  readonly flowName: string;
  readonly links: FlowLinks;
}) {
  if (sprints.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarRange} title="No sprints yet" />
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(16rem,22rem)_1fr]">
      <Card padding="sm" className="flex flex-col gap-1 self-start">
        {sprints.map((sprint) => (
          <SprintRow
            key={sprint.id}
            sprint={sprint}
            selected={sprint.id === selected}
            onSelect={() => onSelect(sprint.id)}
          />
        ))}
      </Card>
      {report && (
        <LoadState
          loaded={report}
          label="Loading the report…"
          skeleton={<Skeleton className="h-64 rounded-2xl" />}
        >
          {(sprint) => <SprintReportCard sprint={sprint} flowName={flowName} links={links} />}
        </LoadState>
      )}
    </div>
  );
}

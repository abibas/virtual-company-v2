import type { TaskPriority } from '@mwc/shared/enums';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { TaskDetail } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { formatDateTime } from '../../../components/data/format.ts';
import { Select } from '../../../components/forms/Input.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { ago } from '../../notifications/NotificationList.tsx';
import { Who } from '../Face.tsx';
import { KIND, PRIORITY, PRIORITY_ORDER } from '../words.ts';

/** One fact: its word on the left, its value on the right. */
function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <dt className="shrink-0 text-dim">{term}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right font-medium text-ink">
        {children}
      </dd>
    </div>
  );
}

/** When, as "3 h ago" with the date and time on hover. */
const When = ({ at }: { readonly at: string }) => (
  <time dateTime={at} title={formatDateTime(at)}>
    {ago(at)}
  </time>
);

/** The priority: a select that saves at once for those who may edit, else its badge. */
function Priority({
  value,
  editable,
  onSave,
}: {
  readonly value: TaskPriority;
  readonly editable: boolean;
  readonly onSave: (next: TaskPriority) => Promise<unknown>;
}) {
  const [error, setError] = useState<string>();
  if (!editable)
    return (
      <Badge tone={PRIORITY[value].tone} size="sm">
        {PRIORITY[value].label}
      </Badge>
    );
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Select
        size="sm"
        aria-label="Priority"
        value={value}
        className="w-28!"
        onChange={(event) => {
          setError(undefined);
          onSave(event.target.value as TaskPriority).catch((failure: unknown) =>
            setError(friendlyMessage(failure)),
          );
        }}
        options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY[p].label }))}
      />
      {error && <span className="text-2xs text-failed">{error}</span>}
    </span>
  );
}

/** Where a task stands and whose it is: its flow, step, round, holder and priority, who made it and when it moved. */
export function TaskFacts({
  task,
  nodes,
  teamHref,
  editable,
  onPriority,
}: {
  readonly task: TaskDetail;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly teamHref: string;
  readonly editable: boolean;
  readonly onPriority: (next: TaskPriority) => Promise<unknown>;
}) {
  return (
    <dl className="flex flex-col gap-1 text-sm">
      <Fact term="Flow">
        <Link to={teamHref} className="truncate rounded-xs hover:text-blue">
          {task.flow.name}
        </Link>
      </Fact>
      <Fact term="Step">
        {task.step ? (
          <>
            <span className="truncate">{task.step.name}</span>
            <span className={cx('text-2xs font-semibold', KIND[task.step.kind].text)}>
              {KIND[task.step.kind].label}
            </span>
          </>
        ) : (
          <span className="text-dim">{task.state === 'queued' ? 'Queued' : '—'}</span>
        )}
      </Fact>
      {task.round !== null && <Fact term="Round">{task.round}</Fact>}
      {task.assignee && (
        <Fact term="With">
          <Who who={task.assignee} nodes={nodes} />
        </Fact>
      )}
      <Fact term="Priority">
        <Priority value={task.priority} editable={editable} onSave={onPriority} />
      </Fact>
      <Fact term="Created by">
        <Who who={task.createdBy} nodes={nodes} />
      </Fact>
      <Fact term="Created">
        <When at={task.createdAt} />
      </Fact>
      <Fact term="Updated">
        <When at={task.updatedAt} />
      </Fact>
      {task.closedAt && (
        <Fact term="Closed">
          <When at={task.closedAt} />
        </Fact>
      )}
    </dl>
  );
}

import { ChevronRight, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { DayGroup } from '../data/DayGroup.tsx';
import { type DayGroupOf, groupByDay } from '../data/days.ts';
import { List } from '../data/List.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { SkeletonRow } from '../ui/Skeleton.tsx';
import { AttentionRow } from './AttentionRow.tsx';
import type { AttentionItem } from './kinds.ts';

/** The title, the scope, "See all" once there is something to see, and the header's own action (collapse). */
function FeedHeader({
  subtitle,
  seeAllHref,
  action,
}: {
  readonly subtitle: string;
  readonly seeAllHref?: string;
  readonly action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 px-1">
      <div>
        <h2 id="attention-title" className="text-md font-bold tracking-[-0.01em] text-ink">
          Attention required
        </h2>
        <p className="text-xs text-dim">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {seeAllHref && (
          <Link
            to={seeAllHref}
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-blue hover:underline"
          >
            See all
            <ChevronRight size={15} strokeWidth={2.5} aria-hidden="true" />
          </Link>
        )}
        {action}
      </div>
    </header>
  );
}

/** The rows by day, the loading rows, or the empty state. */
function FeedBody({
  groups,
  loading,
}: {
  readonly groups: readonly DayGroupOf<AttentionItem>[];
  readonly loading: boolean;
}) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading what needs you" className="px-1">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <EmptyState icon={Inbox} tone="blue" title="Nothing needs you right now" size="sm" className="py-10">
        Questions, blockers and reviews from your agents land here.
      </EmptyState>
    );
  }
  return groups.map((group) => (
    <DayGroup key={group.label} label={group.label}>
      <List>
        {group.items.map((item) => (
          <AttentionRow key={item.id} item={item} />
        ))}
      </List>
    </DayGroup>
  ));
}

/**
 * The feed of what needs the person: a title, "See all", the scope, then the items by day. Empty, it says so; the
 * items come from S5's inbox (nothing yet).
 */
export function AttentionFeed({
  items,
  loading = false,
  now,
  seeAllHref,
  subtitle = 'Across all companies',
  action,
  className,
}: {
  readonly items: readonly AttentionItem[];
  readonly loading?: boolean;
  readonly now?: Date;
  readonly seeAllHref?: string;
  readonly subtitle?: string;
  /** Beside "See all" in the header: the right rail's collapse button. */
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  const groups = groupByDay(items, (item) => item.at, now);
  return (
    <section aria-labelledby="attention-title" className={cx('flex min-h-0 flex-col', className)}>
      <FeedHeader
        subtitle={subtitle}
        action={action}
        {...(seeAllHref && items.length > 0 ? { seeAllHref } : {})}
      />
      <div className="scroll-quiet mt-1 min-h-0 flex-1 overflow-y-auto">
        <FeedBody groups={groups} loading={loading} />
      </div>
    </section>
  );
}

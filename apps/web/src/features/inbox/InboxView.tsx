import type { InboxItem } from '../../api/inbox.ts';
import { companyPath } from '../../app/nav.ts';
import { SkeletonRow } from '../../components/ui/Skeleton.tsx';
import { InboxCard, type InboxMove } from './InboxCard.tsx';
import type { InboxAnswer } from './InboxQuestion.tsx';

/**
 * The right rail's Attention view (S6b): what needs the person across their companies, the most urgent first (the
 * server's order), as compact cards; loading rows the first time, one line when it did not load or holds nothing. The
 * data and the moves come as props, so the design gallery draws it on samples.
 */
export function InboxView({
  items,
  loading,
  failed,
  companyId,
  onAct,
  onAnswer,
}: {
  readonly items: readonly InboxItem[] | undefined;
  readonly loading: boolean;
  /** The last read failed (shown only while nothing was read yet). */
  readonly failed: boolean;
  /** The page's company: items of another one name theirs. */
  readonly companyId: string;
  readonly onAct: (item: InboxItem, move: InboxMove) => Promise<void>;
  /** Answers an agent's question in place (S6c). */
  readonly onAnswer?: InboxAnswer | undefined;
}) {
  if (items === undefined && loading) {
    return (
      <div role="status" aria-label="Loading what needs you" className="px-1">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (items === undefined || items.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-dim">
        {items === undefined && failed ? 'Your inbox did not load. Try again soon.' : 'Nothing needs you.'}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2 px-1 pt-0.5 pb-1">
      {items.map((item) => (
        <li key={item.id}>
          <InboxCard
            item={item}
            href={companyPath(item.company.slug, item.link)}
            company={item.company.id !== companyId}
            onAct={onAct}
            onAnswer={onAnswer}
          />
        </li>
      ))}
    </ul>
  );
}

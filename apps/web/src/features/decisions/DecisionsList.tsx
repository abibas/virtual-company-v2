import { type ReactNode, useState } from 'react';
import {
  type Decision,
  type DecisionOutcome,
  type DecisionQuery,
  useDecisions,
} from '../../api/decisions.ts';
import { ago, formatDateTime } from '../../components/data/format.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { DecisionCard, OUTCOMES } from '../../components/feed/DecisionCard.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { Button } from '../../components/ui/Button.tsx';

/**
 * A list of recorded decisions (2026-11-14), newest first, filtered by outcome: an agent's (its page) or a task's (its
 * Decisions tab). Each card says when, whose when the list mixes agents, and where it was made (`where`: a link to its
 * chat and turn). Members and above read them; the page leaves the list out for anyone else.
 */

type Filter = 'all' | DecisionOutcome;

const FILTERS: readonly SegmentOption<Filter>[] = [
  { value: 'all', label: 'All' },
  ...(Object.entries(OUTCOMES) as [DecisionOutcome, { word: string }][]).map(([value, { word }]) => ({
    value,
    label: word,
  })),
];

/** Under a card: whose (when known), when, and where it was made. */
function Footer({
  decision,
  who,
  where,
}: {
  readonly decision: Decision;
  readonly who: string | undefined;
  readonly where: ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {who && <span className="font-semibold text-dim">{who}</span>}
      {who && <span aria-hidden="true">·</span>}
      <time dateTime={decision.createdAt} title={formatDateTime(decision.createdAt)}>
        {ago(decision.createdAt)}
      </time>
      <span aria-hidden="true">·</span>
      {where}
    </span>
  );
}

export function DecisionsList({
  companyId,
  query,
  agentName,
  where,
}: {
  readonly companyId: string;
  /** Whose decisions: an agent's, a task's, or those made for a contact (2026-11-14). */
  readonly query: Pick<DecisionQuery, 'agent' | 'task' | 'contact'>;
  /** The agent's name for each card, when the list mixes agents. */
  readonly agentName?: ((agentId: string) => string | undefined) | undefined;
  /** Where a decision was made: a link to its chat and turn. */
  readonly where: (decision: Decision) => ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const list = useDecisions(companyId, filter === 'all' ? query : { ...query, outcome: filter });
  return (
    <div className="grid gap-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} label="Outcome" size="sm" />
      </div>
      <LoadState loaded={list} label="Loading the decisions…">
        {() =>
          list.rows.length === 0 ? (
            <p className="text-sm text-dim">
              {filter === 'all' ? 'None recorded.' : 'None with this outcome.'}
            </p>
          ) : (
            <ol className="grid gap-2">
              {list.rows.map((decision) => (
                <li key={decision.id}>
                  <DecisionCard
                    decision={decision}
                    footer={
                      <Footer
                        decision={decision}
                        who={agentName?.(decision.agentId)}
                        where={where(decision)}
                      />
                    }
                  />
                </li>
              ))}
            </ol>
          )
        }
      </LoadState>
      {list.hasMore && (
        <Button
          tone="quiet"
          size="sm"
          busy={list.loadingMore}
          onClick={() => void list.more()}
          className="w-fit"
        >
          Show older
        </Button>
      )}
    </div>
  );
}

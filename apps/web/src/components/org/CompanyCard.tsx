import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { CompanyLogo } from '../ui/CompanyLogo.tsx';
import { COMPANY, DROP_ID, DROP_LOOK, type DropState } from './ChartCard.tsx';
import { CARD } from './layout.ts';

export interface CompanyCardProps {
  readonly name: string;
  /** Its logo (an object URL), or null for its initials. */
  readonly logo: string | null;
  /** What the chart holds, under the name ("3 people · 2 agents"). */
  readonly summary: string;
  /** While a card is dragged: whether it may go to the top of the chart (only people may). */
  readonly drop?: DropState | undefined;
  /** Its menu, top right. */
  readonly actions?: ReactNode;
}

/** What the company card says while a card is dragged, by where that card may go. */
const DROP_HINTS: Partial<Record<DropState, string>> = {
  valid: 'Drop here to put them at the top',
  over: 'Drop here to put them at the top',
  refused: 'Agents always report to someone',
  current: 'At the top already',
};

/**
 * The company at the top of the chart canvas: its logo or initials, its name and what the chart holds. Everyone at the
 * top hangs from it, and dropping a person on it puts them at the top (an agent never goes there).
 */
export function CompanyCard({ name, logo, summary, drop, actions }: CompanyCardProps) {
  const hint = drop && DROP_HINTS[drop];
  return (
    <article
      aria-label={`${name}, the company`}
      {...{ [DROP_ID]: COMPANY }}
      style={{ width: CARD.width, height: CARD.height }}
      className={cx(
        'relative flex flex-col justify-center gap-2 rounded-xl bg-surface p-3 shadow-card ring-1 ring-line transition-[opacity,transform,box-shadow] duration-150',
        drop && DROP_LOOK[drop],
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <CompanyLogo name={name} src={logo} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold tracking-[-0.01em] text-ink">{name}</p>
          <p className="truncate text-xs text-dim">Organization</p>
        </div>
        {actions && <div className="-mr-1 flex shrink-0 items-center self-start">{actions}</div>}
      </div>
      <p className={cx('truncate text-2xs', hint ? 'font-semibold text-blue' : 'text-dim')}>
        {hint ?? summary}
      </p>
    </article>
  );
}

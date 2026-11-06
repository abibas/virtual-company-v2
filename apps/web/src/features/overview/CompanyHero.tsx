import type { ReactNode } from 'react';
import { cx } from '../../components/cx.ts';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { CompanyLogo } from '../../components/ui/CompanyLogo.tsx';

/**
 * The blue card at the top of a company's home: its logo, name and status, the person's place in it, and quick
 * actions. `compact` is the same card drawn small, for the preview on the create-company page.
 */
export function CompanyHero({
  name,
  status,
  summary,
  logoSrc,
  actions,
  compact = false,
}: {
  readonly name: string;
  readonly status: string;
  /** One line about the person's role here. */
  readonly summary: string;
  /** The company's logo (an object URL); its initials without one. */
  readonly logoSrc?: string | null | undefined;
  readonly actions?: ReactNode;
  readonly compact?: boolean;
}) {
  return (
    <Card variant="hero" padding={compact ? 'sm' : 'lg'} className={compact ? 'rounded-xl' : 'rounded-3xl'}>
      <div className={cx('flex items-start', compact ? 'gap-3' : 'gap-4 md:gap-5')}>
        <CompanyLogo
          name={name}
          src={logoSrc}
          size={compact ? 'md' : 'lg'}
          inverse
          className="shadow-[0_10px_24px_-10px_rgba(0,0,0,0.4)]"
        />
        <div className="min-w-0 flex-1">
          <StatusPill status={status} inverse size={compact ? 'sm' : undefined} />
          <h2
            className={cx(
              'font-extrabold tracking-[-0.03em] text-white',
              compact ? 'mt-1 truncate text-xl' : 'mt-3 max-w-2xl text-3xl md:text-4xl',
            )}
          >
            {name}
          </h2>
          <p className={cx('text-white/80', compact ? 'mt-0.5 text-xs' : 'mt-2 max-w-xl text-md')}>
            {summary}
          </p>
        </div>
      </div>
      {actions && (
        <div className={cx('flex flex-wrap items-center', compact ? 'mt-3 gap-2' : 'mt-6 gap-2.5')}>
          {actions}
        </div>
      )}
    </Card>
  );
}

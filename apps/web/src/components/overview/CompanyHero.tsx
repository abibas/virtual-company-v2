import type { ReactNode } from 'react';
import { StatusPill } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';

/** The blue card at the top of a company's home: its name and status, the person's place in it, and quick actions. */
export function CompanyHero({
  name,
  status,
  summary,
  actions,
}: {
  readonly name: string;
  readonly status: string;
  /** One line about the person's role here. */
  readonly summary: string;
  readonly actions?: ReactNode;
}) {
  return (
    <Card variant="hero" padding="lg" className="rounded-3xl">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={status} inverse />
      </div>
      <h2 className="mt-4 max-w-2xl text-3xl font-extrabold tracking-[-0.03em] text-white md:text-4xl">
        {name}
      </h2>
      <p className="mt-2 max-w-xl text-md text-white/80">{summary}</p>
      {actions && <div className="mt-6 flex flex-wrap items-center gap-2.5">{actions}</div>}
    </Card>
  );
}

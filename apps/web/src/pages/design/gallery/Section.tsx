import type { ReactNode } from 'react';
import { cx } from '../../../components/cx.ts';
import { Card } from '../../../components/ui/Card.tsx';

/** One component's place in the gallery: its name, what it is for, and its states below. */
export function Section({
  id,
  title,
  children,
  description,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h3 id={`${id}-title`} className="text-lg font-bold tracking-[-0.01em] text-ink">
        {title}
      </h3>
      {description && <p className="mt-1 max-w-prose text-sm text-dim">{description}</p>}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </Card>
  );
}

/** A labelled row of examples. */
export function Example({
  label,
  wrap = true,
  className,
  children,
}: {
  readonly label: string;
  readonly wrap?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-2.5 text-xs font-semibold text-dim">{label}</p>
      <div className={cx(wrap ? 'flex flex-wrap items-center gap-3' : 'flex flex-col gap-3', className)}>
        {children}
      </div>
    </div>
  );
}

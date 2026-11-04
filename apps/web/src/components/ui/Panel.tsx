import { type ReactNode, useId } from 'react';
import { cx } from '../cx.ts';
import { Card, type CardPadding } from './Card.tsx';

interface PanelProps {
  readonly title: string;
  readonly description?: ReactNode;
  /** Controls on the right of the title (a switch, a button, a link). */
  readonly actions?: ReactNode;
  /** `danger` frames an irreversible action. */
  readonly tone?: 'default' | 'danger';
  readonly padding?: CardPadding;
  readonly className?: string;
  readonly children: ReactNode;
}

/** A titled section of a page: a card with a header (title, what it is for, controls) and its content. */
export function Panel({
  title,
  description,
  actions,
  tone = 'default',
  padding = 'md',
  className,
  children,
}: PanelProps) {
  const id = useId();
  return (
    <Card
      as="section"
      aria-labelledby={id}
      padding={padding}
      className={cx(tone === 'danger' && 'ring-1 ring-failed/30', className)}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-prose">
          <h2
            id={id}
            className={cx(
              'text-md font-bold tracking-[-0.01em]',
              tone === 'danger' ? 'text-failed' : 'text-ink',
            )}
          >
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-dim">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </Card>
  );
}

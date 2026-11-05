import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { Brand } from '../layout/Brand.tsx';
import { Card } from '../ui/Card.tsx';
import { FeedComposition } from './FeedComposition.tsx';

export const TAGLINE = 'Run a company of people and AI agents.';
export const TAGLINE_LINE = 'One place to see who is doing what, and what needs you.';

/**
 * The gradient side of the split pages: the name, a headline with its line, and a composition at the bottom (the
 * feed of the sign-in pages unless given another one).
 */
export function BrandPanel({
  title = TAGLINE,
  line = TAGLINE_LINE,
  className,
  children,
}: {
  readonly title?: string;
  readonly line?: string;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <Card
      variant="hero"
      padding="none"
      className={cx('flex min-h-full flex-col rounded-3xl p-7 lg:p-10', className)}
    >
      <Brand plain inverse size="lg" />
      <div className="my-10 max-w-md lg:my-auto lg:pt-10">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em] text-white lg:text-4xl">{title}</h1>
        <p className="mt-4 max-w-sm text-md text-white/80">{line}</p>
      </div>
      <div className="mt-auto pt-10">{children ?? <FeedComposition />}</div>
    </Card>
  );
}

/** The phone-width stand-in for the panel: the name and the headline above the form. */
export function BrandStrip({
  title = TAGLINE,
  className,
}: {
  readonly title?: string;
  readonly className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-4', className)}>
      <Brand plain size="md" />
      <p className="text-xl font-extrabold tracking-[-0.02em] text-ink">{title}</p>
    </div>
  );
}

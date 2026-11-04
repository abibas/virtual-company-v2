import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

/** A day's worth of rows under its label ("Today", "Yesterday", "Sat, 24 Oct"). */
export function DayGroup({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={label} className={cx('flex flex-col', className)}>
      <h3 className="px-1 pt-3 pb-1 text-xs font-semibold text-dim">{label}</h3>
      {children}
    </section>
  );
}

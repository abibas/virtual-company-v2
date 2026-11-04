import type { ReactNode } from 'react';

/** A page's title, what the page is for, and its main actions on the right. */
export function PageHeader({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-extrabold tracking-[-0.025em] text-ink">{title}</h2>
        {children && <div className="mt-1 max-w-prose text-sm text-dim">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

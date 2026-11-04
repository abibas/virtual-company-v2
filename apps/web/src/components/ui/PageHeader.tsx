import type { ReactNode } from 'react';

/** A page's title and what the page is for. */
export function PageHeader({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-[28px] font-[450] leading-tight text-ink md:text-[32px]">{title}</h1>
      {children && <div className="mt-2 max-w-prose text-ink-2">{children}</div>}
    </header>
  );
}

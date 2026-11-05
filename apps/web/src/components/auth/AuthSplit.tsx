import type { ReactNode } from 'react';
import { ThemeToggle } from '../layout/ThemeToggle.tsx';
import { BrandPanel, BrandStrip } from './BrandPanel.tsx';

/**
 * The frame of the sign-in, sign-up, invitation and create-company pages: a panel on one side (the brand panel
 * unless given another), the form on the other, help below it. On phones the panel folds into a strip above the form.
 */
export function AuthSplit({
  panel,
  strip,
  corner,
  children,
  footer,
}: {
  /** The gradient side; the brand panel with the feed composition when left out. */
  readonly panel?: ReactNode;
  /** What stands in for the panel on phones; the brand strip when left out. */
  readonly strip?: ReactNode;
  /** Beside the theme toggle, top right: the account menu of a signed-in page. */
  readonly corner?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen p-3 lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,13fr)] lg:gap-3">
      <div className="hidden lg:block">
        <div className="sticky top-3 h-[calc(100vh-1.5rem)]">{panel ?? <BrandPanel />}</div>
      </div>
      <main
        id="main"
        className="relative flex min-h-[calc(100vh-1.5rem)] flex-col items-center px-3 pt-6 pb-12 lg:justify-center lg:py-10"
      >
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <ThemeToggle tone={corner ? 'solid' : 'ghost'} />
          {corner}
        </div>
        {strip ?? <BrandStrip className="mb-8 w-full max-w-md lg:hidden" />}
        <div className="flex w-full max-w-md flex-col items-center">{children}</div>
        {footer && <div className="mt-6 max-w-sm text-center text-sm text-dim">{footer}</div>}
      </main>
    </div>
  );
}

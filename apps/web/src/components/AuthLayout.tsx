import type { ReactNode } from 'react';
import { Brand } from './Brand.tsx';

/** The frame of the sign-in, sign-up and invitation pages: the brand above, the card in the middle, help below. */
export function AuthLayout({
  children,
  footer,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-4 py-4 md:px-8 md:py-6">
        <Brand plain />
      </header>
      <main id="main" className="flex flex-1 flex-col items-center px-4 pt-4 pb-16 md:pt-10">
        {children}
        {footer && <div className="mt-6 max-w-sm text-center text-[13px] text-dim">{footer}</div>}
      </main>
    </div>
  );
}

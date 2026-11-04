import { UserButton } from '@clerk/react';
import type { ReactNode } from 'react';
import { Brand } from '../components/layout/Brand.tsx';

/** The frame of the signed-in pages outside a company: the brand, the user menu, one centred column. */
export function PlainShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <Brand />
          <UserButton />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-10 md:py-16">
        {children}
      </main>
    </div>
  );
}

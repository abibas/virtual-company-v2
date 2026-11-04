import { UserButton } from '@clerk/react';
import type { ReactNode } from 'react';
import { Brand } from '../components/layout/Brand.tsx';
import { ThemeToggle } from '../components/layout/ThemeToggle.tsx';
import { Card } from '../components/ui/Card.tsx';

/** The frame of the signed-in pages outside a company: the brand, the user menu, one card in the middle. */
export function PlainShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 md:px-6">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle tone="solid" />
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface shadow-card">
            <UserButton />
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-xl px-4 py-6 md:py-10">
        <Card padding="lg">{children}</Card>
      </main>
    </div>
  );
}

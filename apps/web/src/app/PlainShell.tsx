import type { ReactNode } from 'react';
import { shellUser } from '../components/auth/AccountMenu.tsx';
import { Brand } from '../components/layout/Brand.tsx';
import { ThemeToggle } from '../components/layout/ThemeToggle.tsx';
import { UserPill } from '../components/layout/TopBar.tsx';
import { Card } from '../components/ui/Card.tsx';
import { useSession } from './session.tsx';

/** The frame of the signed-in pages outside a company: the brand, the person's menu, one card in the middle. */
export function PlainShell({ children }: { readonly children: ReactNode }) {
  const { me } = useSession();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 md:px-6">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle tone="solid" />
          <UserPill user={shellUser(me.user)} compact />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-xl px-4 py-6 md:py-10">
        <Card padding="lg">{children}</Card>
      </main>
    </div>
  );
}

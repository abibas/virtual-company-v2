import type { ReactNode } from 'react';
import { shellUser } from '../components/auth/AccountMenu.tsx';
import { cx } from '../components/cx.ts';
import { Brand } from '../components/layout/Brand.tsx';
import { ThemeToggle } from '../components/layout/ThemeToggle.tsx';
import { UserPill } from '../components/layout/TopBar.tsx';
import { Card } from '../components/ui/Card.tsx';
import { useSession } from './session.tsx';

/**
 * The frame of the signed-in pages outside a company: the brand, the person's menu, and the page: one card in the
 * middle, or with `wide` a wider column whose page lays out its own cards (Subscriptions).
 */
export function PlainShell({
  wide = false,
  children,
}: {
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  const { me } = useSession();
  return (
    <div className="min-h-screen">
      <header
        className={cx(
          'mx-auto flex items-center justify-between gap-3 px-4 py-4 md:px-6',
          wide ? 'max-w-5xl' : 'max-w-3xl',
        )}
      >
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle tone="solid" />
          <UserPill user={shellUser(me.user)} compact />
        </div>
      </header>
      {wide ? (
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pt-4 pb-16 md:px-6 md:pt-8">
          {children}
        </main>
      ) : (
        <main id="main" className="mx-auto w-full max-w-xl px-4 py-6 md:py-10">
          <Card padding="lg">{children}</Card>
        </main>
      )}
    </div>
  );
}

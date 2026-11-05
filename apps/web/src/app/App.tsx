import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { fetchPublicConfig, PublicConfigContext } from '../api/config.ts';
import { friendlyMessage } from '../api/errors.ts';
import { BOOT_RETRY_MS, retryTransient } from '../api/retry.ts';
import type { PublicConfig } from '../api/types.ts';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { Brand } from '../components/layout/Brand.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { Button } from '../components/ui/Button.tsx';
import { NotConfiguredPage } from '../pages/auth/NotConfiguredPage.tsx';
import { ClerkRoot } from './ClerkRoot.tsx';
import { useLocation } from './router.tsx';

type Boot =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'ready'; readonly config: PublicConfig };

/** The design gallery, in development only; left out of the production bundle. */
const DesignPage = import.meta.env.DEV
  ? lazy(() => import('../pages/design/DesignPage.tsx').then((m) => ({ default: m.DesignPage })))
  : null;

/**
 * The app's boot: it reads `GET /api/config` (so one built image runs anywhere; a server restarting is waited for,
 * about 10 seconds), then starts Clerk with the publishable key it gives, or shows that sign-in is not configured on
 * this server. `/design` in development needs neither.
 */
export function App() {
  const { pathname } = useLocation();
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const load = useCallback(() => {
    setBoot({ status: 'loading' });
    retryTransient(fetchPublicConfig, BOOT_RETRY_MS).then(
      (config) => setBoot({ status: 'ready', config }),
      (error: unknown) => setBoot({ status: 'failed', error }),
    );
  }, []);
  useEffect(load, [load]);

  if (DesignPage && (pathname === '/design' || pathname.startsWith('/design/'))) {
    return (
      <Suspense fallback={null}>
        <DesignPage />
      </Suspense>
    );
  }
  if (boot.status === 'loading') {
    return (
      <CenteredState>
        <LoadingBlock label="Connecting to the server…" />
      </CenteredState>
    );
  }
  if (boot.status === 'failed') {
    return (
      <CenteredState>
        <Brand plain />
        <h1 className="mt-8 text-2xl font-extrabold tracking-[-0.025em] text-ink">
          The server does not answer
        </h1>
        <p className="mt-3 text-ink-2">{friendlyMessage(boot.error)}</p>
        <div className="mt-6">
          <Button tone="primary" onClick={load}>
            Try again
          </Button>
        </div>
      </CenteredState>
    );
  }
  const { config } = boot;
  if (config.identity === 'clerk' && config.clerkPublishableKey) {
    return (
      <PublicConfigContext value={config}>
        <ClerkRoot publishableKey={config.clerkPublishableKey} />
      </PublicConfigContext>
    );
  }
  return <NotConfiguredPage config={config} />;
}

import { useCallback, useEffect, useState } from 'react';
import { fetchPublicConfig, PublicConfigContext } from '../api/config.ts';
import { friendlyMessage } from '../api/errors.ts';
import type { PublicConfig } from '../api/types.ts';
import { Brand } from '../components/Brand.tsx';
import { Button } from '../components/ui/Button.tsx';
import { CenteredState, LoadingBlock } from '../components/ui/Loading.tsx';
import { NotConfiguredPage } from '../pages/auth/NotConfiguredPage.tsx';
import { ClerkRoot } from './ClerkRoot.tsx';

type Boot =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'ready'; readonly config: PublicConfig };

/**
 * The app's boot: it reads `GET /api/config` (so one built image runs anywhere), then starts Clerk with the
 * publishable key it gives, or shows that sign-in is not configured on this server.
 */
export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const load = useCallback(() => {
    setBoot({ status: 'loading' });
    fetchPublicConfig().then(
      (config) => setBoot({ status: 'ready', config }),
      (error: unknown) => setBoot({ status: 'failed', error }),
    );
  }, []);
  useEffect(load, [load]);

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
        <h1 className="mt-8 font-display text-[26px] font-[450] text-ink">The server does not answer</h1>
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

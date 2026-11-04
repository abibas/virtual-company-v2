import type { PublicConfig } from '../../api/types.ts';
import { ApiStatus } from '../../components/auth/ApiStatus.tsx';
import { AuthSplit } from '../../components/auth/AuthSplit.tsx';
import { Card } from '../../components/ui/Card.tsx';

/** Every page when the server has no identity provider (`identity: none`): what is missing and who can fix it. */
export function NotConfiguredPage({ config }: { readonly config: PublicConfig }) {
  return (
    <AuthSplit>
      <Card padding="lg" className="w-full">
        <h2 className="text-2xl font-extrabold tracking-[-0.025em] text-ink">Sign-in is not configured</h2>
        <p className="mt-2 text-sm text-ink-2">
          People sign in with Clerk, and this server has no Clerk keys, so nobody can sign in yet. Whoever
          runs the server sets <code className="font-mono text-xs">CLERK_SECRET_KEY</code> and{' '}
          <code className="font-mono text-xs">CLERK_PUBLISHABLE_KEY</code> in its environment (in development,
          in <code className="font-mono text-xs">.env.local</code> at the repository root) and restarts it.
        </p>
        <div className="mt-6 rounded-xl bg-surface-2 p-4">
          <ApiStatus />
          <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-dim">API address</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-ink-2">{config.apiUrl}</dd>
            <dt className="text-dim">Web address it expects</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-ink-2">{config.webOrigin}</dd>
          </dl>
        </div>
      </Card>
    </AuthSplit>
  );
}

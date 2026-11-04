import type { PublicConfig } from '../../api/types.ts';
import { ApiStatus } from '../../components/ApiStatus.tsx';
import { AuthLayout } from '../../components/AuthLayout.tsx';

/** Every page when the server has no identity provider (`identity: none`): what is missing and who can fix it. */
export function NotConfiguredPage({ config }: { readonly config: PublicConfig }) {
  return (
    <AuthLayout>
      <div className="w-full max-w-xl">
        <h1 className="font-display text-[28px] font-[450] leading-tight text-ink md:text-[32px]">
          Sign-in is not configured on this server
        </h1>
        <p className="mt-3 text-ink-2">
          People sign in with Clerk, and this server has no Clerk keys, so nobody can sign in yet. Whoever
          runs the server sets <code className="font-mono text-[13px]">CLERK_SECRET_KEY</code> and{' '}
          <code className="font-mono text-[13px]">CLERK_PUBLISHABLE_KEY</code> in its environment (in
          development, in <code className="font-mono text-[13px]">.env.local</code> at the repository root)
          and restarts it.
        </p>
        <section aria-label="Server" className="mt-8 rounded-md border border-line bg-panel-solid p-4 md:p-5">
          <ApiStatus />
          <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-[13.5px] sm:grid-cols-[auto_1fr]">
            <dt className="text-dim">API address</dt>
            <dd className="min-w-0 break-all font-mono text-[13px] text-ink-2">{config.apiUrl}</dd>
            <dt className="text-dim">Web address it expects</dt>
            <dd className="min-w-0 break-all font-mono text-[13px] text-ink-2">{config.webOrigin}</dd>
          </dl>
        </section>
      </div>
    </AuthLayout>
  );
}

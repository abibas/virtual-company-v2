import { useClerk } from '@clerk/react';
import { type ComponentType, useEffect, useMemo, useState } from 'react';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { ApiKeysPage } from '../pages/company/ApiKeysPage.tsx';
import { MembersPage } from '../pages/company/MembersPage.tsx';
import { OverviewPage } from '../pages/company/OverviewPage.tsx';
import { SettingsPage } from '../pages/company/SettingsPage.tsx';
import { AppHeader } from './AppHeader.tsx';
import { CompanyContext } from './company.ts';
import { PlainShell } from './PlainShell.tsx';
import { Link } from './router.tsx';
import { rememberCompany, useSession } from './session.tsx';

/** The pages of a company, by the path after `/c/:slug/`. */
const SECTIONS: Readonly<Record<string, ComponentType>> = {
  '': OverviewPage,
  members: MembersPage,
  'api-keys': ApiKeysPage,
  settings: SettingsPage,
};

/** How often the shell asks again while the company is being set up at the identity provider. */
const PROVISIONING_POLL_MS = 5000;

/**
 * Makes the company's organization Clerk's active one, so Clerk's own components agree with the page. Access never
 * depends on it (the server reads our memberships), so a refusal (Clerk does not know the membership yet) is ignored.
 */
function useActiveOrganization(orgId: string | null) {
  const clerk = useClerk();
  useEffect(() => {
    if (!orgId || !clerk.loaded || clerk.organization?.id === orgId) return;
    clerk.setActive({ organization: orgId }).catch(() => undefined);
  }, [clerk, orgId]);
}

function NoCompany({ slug }: { readonly slug: string }) {
  return (
    <PlainShell>
      <PageHeader title="No company here">
        <p>
          There is no company at <code className="font-mono text-[13px]">/c/{slug}</code> that you are a
          member of. It may have been renamed or deleted, or your membership ended.
        </p>
      </PageHeader>
      <Link to="/" className="text-amber underline underline-offset-4">
        Open one of your companies
      </Link>
    </PlainShell>
  );
}

/**
 * The person's active membership in the company at `slug`, kept in step: remembered as the last company, made Clerk's
 * active organization, polled while the company is being set up, and checked once more before it counts as unknown
 * (a new slug, a company just joined). `checked` is false until then.
 */
function useCompanyMembership(slug: string) {
  const { me, reload } = useSession();
  const membership = me.memberships.find((m) => m.slug === slug && m.status === 'active');
  const provisioning = membership?.companyStatus === 'provisioning';
  const [checkedSlug, setCheckedSlug] = useState<string>();

  useEffect(() => {
    if (membership) rememberCompany(membership.slug);
  }, [membership]);
  useActiveOrganization(membership?.identityOrgId ?? null);
  useEffect(() => {
    if (!provisioning) return;
    const timer = setInterval(() => void reload().catch(() => undefined), PROVISIONING_POLL_MS);
    return () => clearInterval(timer);
  }, [provisioning, reload]);
  useEffect(() => {
    if (membership || checkedSlug === slug) return;
    void reload()
      .catch(() => undefined)
      .finally(() => setCheckedSlug(slug));
  }, [membership, checkedSlug, slug, reload]);

  const view = useMemo(() => (membership ? { membership, me, reload } : null), [membership, me, reload]);
  return { view, provisioning, checked: checkedSlug === slug };
}

/** `/c/:slug/...`: a company the person is an active member of, with its header, navigation and page. */
export function CompanyShell({ slug, section }: { readonly slug: string; readonly section: string }) {
  const { view, provisioning, checked } = useCompanyMembership(slug);
  if (view === null && !checked) {
    return (
      <CenteredState>
        <LoadingBlock label="Opening the company…" />
      </CenteredState>
    );
  }
  if (view === null) return <NoCompany slug={slug} />;
  const Page = SECTIONS[section];
  return (
    <CompanyContext value={view}>
      <div className="min-h-screen">
        <a
          href="#main"
          className="sr-only rounded-sm bg-panel-solid px-3 py-2 text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-40"
        >
          Skip to content
        </a>
        <AppHeader membership={view.membership} section={section} />
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 outline-none md:px-8 md:py-10">
          {provisioning && (
            <div className="mb-6">
              <Notice tone="warning">
                This company is being set up with the sign-in service. Invitations go out as soon as it is
                ready, usually within a minute.
              </Notice>
            </div>
          )}
          {Page ? (
            <Page />
          ) : (
            <PageHeader title="Page not found">
              <p>This company has no page at this address.</p>
            </PageHeader>
          )}
        </main>
      </div>
    </CompanyContext>
  );
}

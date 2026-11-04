import { UserButton, useClerk } from '@clerk/react';
import { type ComponentType, useEffect, useMemo, useState } from 'react';
import { useAttention } from '../api/attention.ts';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { AppShell } from '../components/layout/AppShell.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { firstName } from '../components/layout/greeting.ts';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { roleName } from '../components/ui/Badge.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { ApiKeysPage } from '../pages/company/ApiKeysPage.tsx';
import { MembersPage } from '../pages/company/MembersPage.tsx';
import { OverviewPage } from '../pages/company/OverviewPage.tsx';
import { SettingsPage } from '../pages/company/SettingsPage.tsx';
import { CompanySwitcher } from './CompanySwitcher.tsx';
import { CompanyContext } from './company.ts';
import { companyNav } from './nav.ts';
import { PlainShell } from './PlainShell.tsx';
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
          There is no company at <code className="font-mono text-xs">/c/{slug}</code> that you are a member
          of. It may have been renamed or deleted, or your membership ended.
        </p>
      </PageHeader>
      <ButtonLink href="/" tone="primary">
        Open one of your companies
      </ButtonLink>
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

/** `/c/:slug/...`: a company the person is an active member of, in the app shell, with its page. */
export function CompanyShell({ slug, section }: { readonly slug: string; readonly section: string }) {
  const { view, provisioning, checked } = useCompanyMembership(slug);
  const attention = useAttention();
  if (view === null && !checked) {
    return (
      <CenteredState>
        <LoadingBlock label="Opening the company…" />
      </CenteredState>
    );
  }
  if (view === null) return <NoCompany slug={slug} />;
  const Page = SECTIONS[section];
  const { membership, me } = view;
  return (
    <CompanyContext value={view}>
      <AppShell
        nav={companyNav(membership.slug, section)}
        badge={<CompanySwitcher current={membership} section={section} />}
        firstName={firstName(me.user.displayName, me.user.email)}
        user={{
          name: me.user.displayName || me.user.email,
          role: roleName(membership.role),
          menu: <UserButton />,
        }}
        attention={attention.items}
        attentionLoading={attention.loading}
        agents={[]}
        banner={
          provisioning && (
            <Notice tone="warning">
              This company is being set up with the sign-in service. Invitations go out as soon as it is
              ready, usually within a minute.
            </Notice>
          )
        }
      >
        {Page ? (
          <Page />
        ) : (
          <PageHeader title="Page not found">
            <p>This company has no page at this address.</p>
          </PageHeader>
        )}
      </AppShell>
    </CompanyContext>
  );
}

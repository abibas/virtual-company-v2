import { UserButton, useClerk } from '@clerk/react';
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAttention } from '../api/attention.ts';
import { useAgentList } from '../api/org.ts';
import { usePendingLogo } from '../api/pending-logo.ts';
import { LogoRetryNotice } from '../components/company/LogoRetryNotice.tsx';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { AppShell } from '../components/layout/AppShell.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { firstName } from '../components/layout/greeting.ts';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { agentRef } from '../components/org/agent-labels.ts';
import { roleName } from '../components/ui/Badge.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { AgentPage } from '../pages/company/AgentPage.tsx';
import { AgentsPage } from '../pages/company/AgentsPage.tsx';
import { ApiKeysPage } from '../pages/company/ApiKeysPage.tsx';
import { MembersPage } from '../pages/company/MembersPage.tsx';
import { OverviewPage } from '../pages/company/OverviewPage.tsx';
import { SettingsPage } from '../pages/company/SettingsPage.tsx';
import { CompanySwitcher } from './CompanySwitcher.tsx';
import { CompanyContext, type CompanyView } from './company.ts';
import { companyHrefs, companyNav } from './nav.ts';
import { PlainShell } from './PlainShell.tsx';
import { rememberCompany, useSession } from './session.tsx';

/** The pages of a company, by the path after `/c/:slug/`. */
const SECTIONS: Readonly<Record<string, ComponentType>> = {
  '': OverviewPage,
  agents: AgentsPage,
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

/** The page at `section` (the path after `/c/:slug/`): a company page, an agent's page, or not found. */
function pageAt(section: string): ReactNode {
  const [head = '', ...rest] = section.split('/');
  const address = rest.length === 1 ? rest[0] : undefined;
  if (head === 'agents' && address) return <AgentPage address={address} />;
  const Page = rest.length === 0 ? SECTIONS[head] : undefined;
  if (Page) return <Page />;
  return (
    <PageHeader title="Page not found">
      <p>This company has no page at this address.</p>
    </PageHeader>
  );
}

/**
 * The company's frame around its page: the rail and the switcher (to the same section of another company), the
 * attention feed, the quick-create dock with the team's faces (its tasks arrive in S4), and the company's notices.
 */
function CompanyFrame({
  view,
  section,
  provisioning,
}: {
  readonly view: Omit<CompanyView, 'agents'>;
  readonly section: string;
  readonly provisioning: boolean;
}) {
  const { membership, me } = view;
  const attention = useAttention();
  const pendingLogo = usePendingLogo(membership.companyId);
  const agents = useAgentList(membership.companyId);
  const head = section.split('/')[0] ?? '';
  return (
    <CompanyContext value={{ ...view, agents }}>
      <AppShell
        nav={companyNav(companyHrefs(membership.slug), head)}
        badge={<CompanySwitcher current={membership} section={head} />}
        firstName={firstName(me.user.displayName, me.user.email)}
        user={{
          name: me.user.displayName || me.user.email,
          role: roleName(membership.role),
          menu: <UserButton />,
        }}
        attention={attention.items}
        attentionLoading={attention.loading}
        agents={agents.data?.agents.map(agentRef) ?? []}
        quickCreateNote="Tasks arrive in S4"
        banner={
          (provisioning || pendingLogo) && (
            <div className="flex flex-col gap-3">
              {provisioning && (
                <Notice tone="warning">
                  This company is being set up with the sign-in service. Invitations go out as soon as it is
                  ready, usually within a minute.
                </Notice>
              )}
              {pendingLogo && <LogoRetryNotice pending={pendingLogo} onUploaded={view.reload} />}
            </div>
          )
        }
      >
        {pageAt(section)}
      </AppShell>
    </CompanyContext>
  );
}

/** `/c/:slug/...`: a company the person is an active member of, in the app shell, with its page. */
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
  return <CompanyFrame view={view} section={section} provisioning={provisioning} />;
}

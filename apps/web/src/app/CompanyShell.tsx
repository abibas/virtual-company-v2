import { useClerk } from '@clerk/react';
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useAttention } from '../api/attention.ts';
import { useAgentList } from '../api/org.ts';
import { usePendingLogo } from '../api/pending-logo.ts';
import { shellUser } from '../components/auth/AccountMenu.tsx';
import { LoadingBlock } from '../components/data/LoadState.tsx';
import { AppShell } from '../components/layout/AppShell.tsx';
import { CenteredState } from '../components/layout/CenteredState.tsx';
import { firstName } from '../components/layout/greeting.ts';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { agentRef } from '../components/org/agent-labels.ts';
import { roleName } from '../components/ui/Badge.tsx';
import { Notice } from '../components/ui/Notice.tsx';
import { LogoRetryNotice } from '../features/company/LogoRetryNotice.tsx';
import { structureTabAt } from '../features/structure/StructureView.tsx';
import { AgentPage } from '../pages/company/AgentPage.tsx';
import { ApiKeysPage } from '../pages/company/ApiKeysPage.tsx';
import { ChatPage } from '../pages/company/ChatPage.tsx';
import { MachinesPage } from '../pages/company/MachinesPage.tsx';
import { OverviewPage } from '../pages/company/OverviewPage.tsx';
import {
  GatewaysCompanyPage,
  ProfilesCompanyPage,
  SubscriptionsCompanyPage,
} from '../pages/company/PersonalPages.tsx';
import { SettingsPage } from '../pages/company/SettingsPage.tsx';
import { StructurePage } from '../pages/company/StructurePage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { CompanySwitcher } from './CompanySwitcher.tsx';
import { CompanyContext, type CompanyView } from './company.ts';
import { companyHrefs, companyNav, companyPath, movedSection, railSection } from './nav.ts';
import { Redirect, useLocation } from './router.tsx';
import { rememberCompany, useSession } from './session.tsx';

/** The pages of a company, by the path after `/:slug/`; `subscriptions`, `gateways` and `profiles` are the person's own. */
const SECTIONS: Readonly<Record<string, ComponentType>> = {
  '': OverviewPage,
  machines: MachinesPage,
  subscriptions: SubscriptionsCompanyPage,
  gateways: GatewaysCompanyPage,
  profiles: ProfilesCompanyPage,
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

/**
 * The page at `section` (the path after `/:slug/`): a company page, a Company structure tab, an agent's page or chats,
 * or not found.
 */
function pageAt(section: string): ReactNode {
  const [head = '', ...rest] = section.split('/');
  const address = rest.length === 1 ? rest[0] : undefined;
  const tab = head === 'structure' && rest.length <= 1 ? structureTabAt(rest[0] ?? '') : undefined;
  if (tab) return <StructurePage tab={tab} />;
  if (head === 'agents' && address) return <AgentPage address={address} />;
  if (head === 'chats' && address) return <ChatPage key={address} agentId={address} />;
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
  // An agent's page and chats belong to Company structure (the rail, and the switcher's section in another company).
  const head = railSection(section.split('/')[0] ?? '');
  return (
    <CompanyContext value={{ ...view, agents }}>
      <AppShell
        nav={companyNav(companyHrefs(membership.slug), head)}
        badge={<CompanySwitcher current={membership} section={head} />}
        firstName={firstName(me.user.displayName, me.user.email)}
        user={shellUser(me.user, roleName(membership.role))}
        attention={attention.items}
        attentionLoading={attention.loading}
        agents={agents.data?.agents.map((agent) => ({ ...agentRef(agent), icon: agent.icon })) ?? []}
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

/**
 * `/:slug/...`: a company the person is an active member of, in the app shell, with its page; the not-found page for
 * a first segment that is no company of theirs. A page that moved (`agents`, `members`) is replaced by its new address.
 */
export function CompanyShell({ slug, section }: { readonly slug: string; readonly section: string }) {
  const { view, provisioning, checked } = useCompanyMembership(slug);
  const moved = movedSection(section, useLocation().search);
  if (moved !== undefined) return <Redirect to={companyPath(slug, moved)} />;
  if (view === null && !checked) {
    return (
      <CenteredState>
        <LoadingBlock label="Opening the company…" />
      </CenteredState>
    );
  }
  if (view === null) {
    return (
      <NotFoundPage>
        There is no page here, and no company of yours at <code className="font-mono text-xs">/{slug}</code>.
        A company may have been renamed or deleted, or your membership ended.
      </NotFoundPage>
    );
  }
  return <CompanyFrame view={view} section={section} provisioning={provisioning} />;
}

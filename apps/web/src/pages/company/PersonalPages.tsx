import { PROFILE_PROVIDERS } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import type { ReactNode } from 'react';
import { useCompany } from '../../app/company.ts';
import { useLocation } from '../../app/router.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { GatewaysTab } from '../../features/subscriptions/GatewaysTab.tsx';
import { ProfilesTab } from '../../features/subscriptions/ProfilesTab.tsx';
import { SubscriptionsTab } from '../../features/subscriptions/SubscriptionsTab.tsx';

/** A personal page's header: its title and its actions, no description (Ihor: no filler text). */
const header =
  (title: string) =>
  (actions: ReactNode): ReactNode => <PageHeader title={title} actions={actions} />;

/**
 * `/:slug/subscriptions`: the person's own AI subscriptions (Sign in with Claude or OpenAI, a pasted setup-token, API
 * keys) with their limits, and their tool sign-ins (GitHub, Atlassian); the same in every company of theirs.
 */
export function SubscriptionsCompanyPage() {
  return <SubscriptionsTab header={header('Subscriptions')} />;
}

/** `/:slug/gateways`: the person's own AI gateways; `?add=1` (Add a gateway on a Claude profile) opens Add gateway. */
export function GatewaysCompanyPage() {
  const { search } = useLocation();
  return <GatewaysTab addOnOpen={search.get('add') === '1'} header={header('AI gateways')} />;
}

/** What `?new=` asks of the profiles page: New profile for that provider, or at its provider choice. */
function newProfileOf(wanted: string | null): ProfileProvider | 'choose' | undefined {
  if (wanted === null) return undefined;
  return PROFILE_PROVIDERS.find((provider) => provider === wanted) ?? 'choose';
}

/**
 * `/:slug/profiles`: the person's own access profiles, Claude's, OpenAI's, GitHub's and Atlassian's, which they give
 * their agents, and their defaults; `?new=claude|openai|github|atlassian` (an agent form's "Make one") opens New profile
 * for that provider.
 */
export function ProfilesCompanyPage() {
  const { me, reload } = useCompany();
  const { search } = useLocation();
  return (
    <ProfilesTab
      memberships={me.memberships}
      onDefaultChanged={reload}
      startWith={newProfileOf(search.get('new'))}
      header={header('Access profiles')}
    />
  );
}

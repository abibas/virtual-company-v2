import type { ReactNode } from 'react';
import { useCompany } from '../../app/company.ts';
import { useLocation } from '../../app/router.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { GatewaysTab } from '../../features/subscriptions/GatewaysTab.tsx';
import { ProfilesTab } from '../../features/subscriptions/ProfilesTab.tsx';
import { SubscriptionsTab } from '../../features/subscriptions/SubscriptionsTab.tsx';

/** A personal page's header: its title, what it holds (the person's own, not the company's), its actions. */
const header =
  (title: string, description: ReactNode) =>
  (actions: ReactNode): ReactNode => (
    <PageHeader title={title} actions={actions}>
      <p>{description}</p>
    </PageHeader>
  );

/**
 * `/:slug/subscriptions`: the person's own AI subscriptions (Sign in with Claude or OpenAI, a pasted setup-token, API
 * keys) with their limits; the same in every company of theirs.
 */
export function SubscriptionsCompanyPage() {
  return (
    <SubscriptionsTab
      header={header(
        'Subscriptions',
        "Yours, not the company's: your Claude and OpenAI sign-ins and API keys, the same in every company. Secrets are stored encrypted and never shown back.",
      )}
    />
  );
}

/** `/:slug/gateways`: the person's own AI gateways; `?add=1` (a profile's empty Gateway slot) opens Add gateway. */
export function GatewaysCompanyPage() {
  const { search } = useLocation();
  return (
    <GatewaysTab
      addOnOpen={search.get('add') === '1'}
      header={header(
        'AI gateways',
        "Yours, not the company's: addresses your agents' Claude Code requests go through, like your own proxy on port 8300; an access profile can include one.",
      )}
    />
  );
}

/** `/:slug/profiles`: the person's own access profiles, the bundles they give their agents, and their defaults. */
export function ProfilesCompanyPage() {
  const { me, reload } = useCompany();
  return (
    <ProfilesTab
      memberships={me.memberships}
      onDefaultChanged={reload}
      header={header(
        'Access profiles',
        "Yours, not the company's: what you give an agent, which of your subscriptions its runs use. A profile never moves a subscription into a company.",
      )}
    />
  );
}

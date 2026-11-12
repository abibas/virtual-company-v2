import type { ProfileProvider } from '@mwc/shared/enums';
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
 * keys) with their limits, and their tool sign-ins (GitHub, Atlassian); the same in every company of theirs.
 */
export function SubscriptionsCompanyPage() {
  return (
    <SubscriptionsTab
      header={header(
        'Subscriptions',
        "Yours, not the company's: your AI subscriptions and your GitHub and Atlassian sign-ins, the same in every company. Secrets are stored encrypted and never shown back.",
      )}
    />
  );
}

/** `/:slug/gateways`: the person's own AI gateways; `?add=1` (Add a gateway on a Claude profile) opens Add gateway. */
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

/** What `?new=` asks of the profiles page: New profile for that provider, or at its provider choice. */
function newProfileOf(wanted: string | null): ProfileProvider | 'choose' | undefined {
  if (wanted === null) return undefined;
  return wanted === 'claude' || wanted === 'openai' ? wanted : 'choose';
}

/**
 * `/:slug/profiles`: the person's own access profiles, Claude's and OpenAI's, which they give their agents, and their
 * defaults; `?new=claude|openai` (an agent form's "Make one") opens New profile for that provider.
 */
export function ProfilesCompanyPage() {
  const { me, reload } = useCompany();
  const { search } = useLocation();
  return (
    <ProfilesTab
      memberships={me.memberships}
      onDefaultChanged={reload}
      startWith={newProfileOf(search.get('new'))}
      header={header(
        'Access profiles',
        "Yours, not the company's: what you give an agent, one of your subscriptions, Claude's for Claude Code agents or OpenAI's for Codex agents. A profile never moves a subscription into a company.",
      )}
    />
  );
}

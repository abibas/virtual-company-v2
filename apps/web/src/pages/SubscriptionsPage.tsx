import { ArrowLeft, Layers, Sparkles, Waypoints } from 'lucide-react';
import { PlainShell } from '../app/PlainShell.tsx';
import { useLocation } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { ACCESS_PROFILES_PATH, GATEWAYS_PATH, SUBSCRIPTIONS_PATH } from '../components/auth/AccountMenu.tsx';
import { Tabs } from '../components/forms/Segmented.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';
import { GatewaysTab } from '../features/subscriptions/GatewaysTab.tsx';
import { ProfilesTab } from '../features/subscriptions/ProfilesTab.tsx';
import { SubscriptionsTab } from '../features/subscriptions/SubscriptionsTab.tsx';

type Tab = 'subscriptions' | 'gateways' | 'profiles';

const tabOf = (value: string | null): Tab =>
  value === 'profiles' || value === 'gateways' ? value : 'subscriptions';

/**
 * `/subscriptions` (from the account menu and the home widget's Manage), personal and outside any company: the
 * person's AI subscriptions (Sign in with Claude or OpenAI, a pasted setup-token, API keys) with their limits,
 * `?tab=gateways` their AI gateways (`&add=1` opens Add gateway), and `?tab=profiles` their access profiles, the
 * bundles they give their agents.
 */
export function SubscriptionsPage() {
  const { me, reload } = useSession();
  const { search } = useLocation();
  const tab = tabOf(search.get('tab'));
  return (
    <PlainShell wide>
      <ButtonLink href="/" tone="quiet" size="sm" icon={ArrowLeft} className="mb-3 -ml-2">
        Back to your company
      </ButtonLink>
      <PageHeader title="Subscriptions">
        <p>
          Sign in to Claude and OpenAI once, here, add API keys and AI gateways, and bundle them into access
          profiles for the agents you power.
        </p>
      </PageHeader>
      <Tabs
        label="Subscriptions views"
        className="mb-5 max-w-full overflow-x-auto"
        items={[
          {
            href: SUBSCRIPTIONS_PATH,
            label: 'Subscriptions',
            icon: Sparkles,
            current: tab === 'subscriptions',
          },
          { href: GATEWAYS_PATH, label: 'AI gateways', icon: Waypoints, current: tab === 'gateways' },
          { href: ACCESS_PROFILES_PATH, label: 'Access profiles', icon: Layers, current: tab === 'profiles' },
        ]}
      />
      {tab === 'profiles' && <ProfilesTab memberships={me.memberships} onDefaultChanged={reload} />}
      {tab === 'gateways' && <GatewaysTab addOnOpen={search.get('add') === '1'} />}
      {tab === 'subscriptions' && <SubscriptionsTab />}
    </PlainShell>
  );
}

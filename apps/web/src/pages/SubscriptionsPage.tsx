import { ArrowLeft, Layers, Sparkles } from 'lucide-react';
import { PlainShell } from '../app/PlainShell.tsx';
import { useLocation } from '../app/router.tsx';
import { useSession } from '../app/session.tsx';
import { ACCESS_PROFILES_PATH, SUBSCRIPTIONS_PATH } from '../components/auth/AccountMenu.tsx';
import { Tabs } from '../components/forms/Segmented.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';
import { ProfilesTab } from '../features/subscriptions/ProfilesTab.tsx';
import { SubscriptionsTab } from '../features/subscriptions/SubscriptionsTab.tsx';

/**
 * `/subscriptions` (from the account menu and the home widget's Manage), personal and outside any company: the
 * person's AI subscriptions (Sign in with Claude or OpenAI, a pasted setup-token, API keys, gateways) with their
 * limits, and `?tab=profiles` their access profiles, the bundles they give their agents.
 */
export function SubscriptionsPage() {
  const { me, reload } = useSession();
  const { search } = useLocation();
  const profiles = search.get('tab') === 'profiles';
  return (
    <PlainShell wide>
      <ButtonLink href="/" tone="quiet" size="sm" icon={ArrowLeft} className="mb-3 -ml-2">
        Back to your company
      </ButtonLink>
      <PageHeader title="Subscriptions">
        <p>
          Sign in to Claude and OpenAI once, here, add API keys and gateways, and bundle them into access
          profiles for the agents you power.
        </p>
      </PageHeader>
      <Tabs
        label="Subscriptions views"
        className="mb-5 max-w-full overflow-x-auto"
        items={[
          { href: SUBSCRIPTIONS_PATH, label: 'Subscriptions', icon: Sparkles, current: !profiles },
          { href: ACCESS_PROFILES_PATH, label: 'Access profiles', icon: Layers, current: profiles },
        ]}
      />
      {profiles ? (
        <ProfilesTab memberships={me.memberships} onDefaultChanged={reload} />
      ) : (
        <SubscriptionsTab />
      )}
    </PlainShell>
  );
}

import { ArrowLeft, Layers, Sparkles, Waypoints } from 'lucide-react';
import { oldPersonalPath, personalPageOf, personalPath } from '../app/nav.ts';
import { PlainShell } from '../app/PlainShell.tsx';
import { Redirect, useLocation } from '../app/router.tsx';
import { chooseCompany, useSession } from '../app/session.tsx';
import { Tabs } from '../components/forms/Segmented.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { ButtonLink } from '../components/ui/Button.tsx';
import { GatewaysTab } from '../features/subscriptions/GatewaysTab.tsx';
import { ProfilesTab } from '../features/subscriptions/ProfilesTab.tsx';
import { SubscriptionsTab } from '../features/subscriptions/SubscriptionsTab.tsx';

/**
 * `/subscriptions` (`?tab=gateways|profiles`, `&add=1`), the old address of the person's own pages: since 2026-11-09
 * they are company pages in the rail, so it opens the matching one (`/:slug/subscriptions`, `/:slug/gateways` with
 * `?add=1`, `/:slug/profiles`) of the company last opened here, else the first one. A person with no company yet keeps
 * the standalone page with its tabs.
 */
export function SubscriptionsPage() {
  const { me, reload } = useSession();
  const { search } = useLocation();
  const tab = personalPageOf(search.get('tab'));
  const add = search.get('add') === '1';
  const company = chooseCompany(me);
  if (company) return <Redirect to={personalPath(company.slug, tab, add)} />;
  return (
    <PlainShell wide>
      <ButtonLink href="/" tone="quiet" size="sm" icon={ArrowLeft} className="mb-3 -ml-2">
        Back to your company
      </ButtonLink>
      <PageHeader title="Subscriptions">
        <p>
          Sign in to Claude and OpenAI once, here, add API keys and AI gateways, and choose them in access
          profiles for the agents you power, one provider each.
        </p>
      </PageHeader>
      <Tabs
        label="Subscriptions views"
        className="mb-5 max-w-full overflow-x-auto"
        items={[
          {
            href: oldPersonalPath('subscriptions'),
            label: 'Subscriptions',
            icon: Sparkles,
            current: tab === 'subscriptions',
          },
          {
            href: oldPersonalPath('gateways'),
            label: 'AI gateways',
            icon: Waypoints,
            current: tab === 'gateways',
          },
          {
            href: oldPersonalPath('profiles'),
            label: 'Profiles',
            icon: Layers,
            current: tab === 'profiles',
          },
        ]}
      />
      {tab === 'profiles' && <ProfilesTab memberships={me.memberships} onDefaultChanged={reload} />}
      {tab === 'gateways' && <GatewaysTab addOnOpen={add} />}
      {tab === 'subscriptions' && <SubscriptionsTab />}
    </PlainShell>
  );
}

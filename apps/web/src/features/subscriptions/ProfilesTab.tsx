import { PROFILE_PROVIDERS } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import { Layers, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import {
  type ProfileCalls,
  profileCalls,
  useAccessProfiles,
  useSubscriptions,
} from '../../api/subscriptions.ts';
import type { AccessProfile, Membership, Subscription } from '../../api/types.ts';
import { navigate, useLocation } from '../../app/router.tsx';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { DefaultProfiles } from './DefaultProfiles.tsx';
import { NewProfileForm } from './NewProfile.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { PROVIDER_STYLES } from './Providers.tsx';
import { profilesOf } from './profile-options.ts';
import type { TabHeader } from './SubscriptionsTab.tsx';

const SKELETON = <Skeleton className="h-48 rounded-2xl" />;

interface ListProps {
  readonly subscriptions: readonly Subscription[];
  readonly calls: ProfileCalls;
  readonly onChanged: () => void;
  /** Opens New profile with this provider chosen. */
  readonly onNew: (provider: ProfileProvider) => void;
}

/** One provider's profiles under its heading, or a line saying there are none with New <provider> profile. */
function ProviderGroup({
  provider,
  profiles,
  subscriptions,
  calls,
  onChanged,
  onNew,
}: ListProps & { readonly provider: ProfileProvider; readonly profiles: readonly AccessProfile[] }) {
  const style = PROVIDER_STYLES[provider];
  return (
    <section aria-label={`${style.name} profiles`} className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile icon={style.icon} size="sm" />
          <h2 className="text-sm font-bold text-ink">{style.name} profiles</h2>
        </div>
        <Button size="sm" tone="quiet" icon={Plus} onClick={() => onNew(provider)}>
          New {style.name} profile
        </Button>
      </header>
      {profiles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-2 px-4 py-3 text-sm text-dim">
          No {style.name} profiles yet.
        </p>
      ) : (
        profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            subscriptions={subscriptions}
            update={(changes) => calls.update(profile.id, changes).then(onChanged)}
            remove={() => calls.remove(profile.id).then(onChanged)}
          />
        ))
      )}
    </section>
  );
}

/** The profiles in groups, Claude then OpenAI; the invitation to make the first one. */
function ProfileList({ profiles, ...rest }: ListProps & { readonly profiles: readonly AccessProfile[] }) {
  if (profiles.length === 0) {
    return (
      <Card>
        <EmptyState icon={Layers} tone="teal" title="No access profiles yet">
          Make one for Claude or for OpenAI, choose its subscription, then give it to your agents on their
          pages.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="grid gap-6">
      {PROFILE_PROVIDERS.map((provider) => (
        <ProviderGroup
          key={provider}
          provider={provider}
          profiles={profilesOf(profiles, provider)}
          {...rest}
        />
      ))}
    </div>
  );
}

/** The tab's top: the page's header with New profile (`header`), else a line saying what a profile is. */
function TabTop({ header, action }: { readonly header: TabHeader | undefined; readonly action: ReactNode }) {
  if (header) return header(action);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-prose text-sm text-dim">
        A profile is what you give an agent: one of your subscriptions, Claude’s or OpenAI’s. It never moves a
        subscription into a company.
      </p>
      {action}
    </div>
  );
}

/** What New profile is: closed, open at the provider choice (`choose`), or open with a provider chosen. */
type Creating = ProfileProvider | 'choose' | null;

/** `?new=` (an agent form's Make one) opens New profile once and leaves the address without it, as `?add=1` does. */
function useNewFromAddress(startWith: Creating | undefined, open: (creating: Creating) => void) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (startWith === undefined || startWith === null) return;
    open(startWith);
    const rest = new URLSearchParams(search);
    rest.delete('new');
    navigate(rest.size > 0 ? `${pathname}?${rest}` : pathname, { replace: true });
  }, [startWith, open, pathname, search]);
}

/**
 * The Access profiles tab: the person's profiles, Claude ones (a Claude subscription and an optional gateway, for Claude
 * Code agents) and OpenAI ones (an OpenAI subscription, for Codex agents), each with its GitHub and Atlassian parts
 * (S7.1b, one profile since 2026-11-13) and the agents using it, New profile, and their defaults per company, one per
 * provider. `memberships` and `onDefaultChanged` are the session's (the page passes them); `header` puts New profile in
 * the page's header; `startWith` opens New profile at once (`?new=claude`).
 */
export function ProfilesTab({
  memberships,
  onDefaultChanged,
  header,
  startWith,
}: {
  readonly memberships: readonly Membership[];
  readonly onDefaultChanged: () => Promise<unknown>;
  readonly header?: TabHeader;
  readonly startWith?: ProfileProvider | 'choose' | undefined;
}) {
  const api = useApi();
  const calls = useMemo(() => profileCalls(api), [api]);
  const profiles = useAccessProfiles();
  const subscriptions = useSubscriptions();
  const [creating, setCreating] = useState<Creating>(null);
  useNewFromAddress(startWith, setCreating);
  const mine = subscriptions.data?.subscriptions ?? [];
  const action: ReactNode = creating === null && (
    <Button size="sm" tone="primary" icon={Plus} onClick={() => setCreating('choose')}>
      New profile
    </Button>
  );
  return (
    <>
      <TabTop header={header} action={action} />
      {creating !== null && (
        <NewProfileForm
          key={creating}
          provider={creating === 'choose' ? undefined : creating}
          subscriptions={mine}
          create={(profile) =>
            calls.create(profile).then(() => {
              setCreating(null);
              profiles.reload();
            })
          }
          onCancel={() => setCreating(null)}
        />
      )}
      <LoadState loaded={profiles} label="Loading your access profiles…" skeleton={SKELETON}>
        {(data) => (
          <ProfileList
            profiles={data.profiles}
            subscriptions={mine}
            calls={calls}
            onChanged={profiles.reload}
            onNew={setCreating}
          />
        )}
      </LoadState>
      <DefaultProfiles
        memberships={memberships}
        profiles={profiles.data?.profiles}
        calls={calls}
        onChanged={onDefaultChanged}
      />
    </>
  );
}

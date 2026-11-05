import { roleAtLeast } from '@mwc/shared/roles';
import { Layers, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import {
  type ProfileCalls,
  profileCalls,
  useAccessProfiles,
  useSubscriptions,
} from '../../api/subscriptions.ts';
import type { AccessProfile, Membership, Subscription } from '../../api/types.ts';
import { LoadState } from '../data/LoadState.tsx';
import { Select } from '../forms/Input.tsx';
import { roleName } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { NewProfileForm, ProfileCard } from './ProfileCard.tsx';

const SKELETON = <Skeleton className="h-48 rounded-2xl" />;

interface DefaultsProps {
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly calls: ProfileCalls;
  /** Saved: read the person's memberships again, which carry the defaults. */
  readonly onChanged: () => Promise<unknown>;
}

/** One company's default, saved as soon as it changes. */
function DefaultRow({
  membership,
  profiles,
  calls,
  onChanged,
}: DefaultsProps & { readonly membership: Membership }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = async (value: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await calls.setDefault(membership.companyId, value || null);
      await onChanged();
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const options = [
    { value: '', label: 'None' },
    ...(profiles ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <label htmlFor={id} className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{membership.name}</span>
        <span className="text-xs text-dim">You are {roleName(membership.role).toLowerCase()} there</span>
      </label>
      <div className="flex w-full flex-col gap-1 sm:w-64">
        <Select
          id={id}
          size="sm"
          value={membership.defaultProfileId ?? ''}
          disabled={busy || profiles === undefined}
          options={options}
          onChange={(event) => void change(event.target.value)}
        />
        {error && (
          <p role="alert" className="text-xs font-medium text-failed">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

/** "Default for agents I hire": a select per company where the person is an admin or owner. */
function DefaultProfiles({
  memberships,
  ...rest
}: DefaultsProps & { readonly memberships: readonly Membership[] }) {
  const companies = memberships.filter((m) => m.status === 'active' && roleAtLeast(m.role, 'admin'));
  if (companies.length === 0) return null;
  return (
    <Panel
      title="Default for agents I hire"
      description="An agent you hire in a company gets this profile, unless you choose another on the hire form."
      className="mt-5"
    >
      <ul className="divide-y divide-line">
        {companies.map((membership) => (
          <DefaultRow key={membership.companyId} membership={membership} {...rest} />
        ))}
      </ul>
    </Panel>
  );
}

/** The profile cards, each change saved at once and the list read again; the invitation to make the first one. */
function ProfileList({
  profiles,
  subscriptions,
  calls,
  onChanged,
}: {
  readonly profiles: readonly AccessProfile[];
  readonly subscriptions: readonly Subscription[];
  readonly calls: ProfileCalls;
  readonly onChanged: () => void;
}) {
  if (profiles.length === 0) {
    return (
      <Card>
        <EmptyState icon={Layers} tone="teal" title="No access profiles yet">
          Make one, choose its subscriptions, then give it to your agents on their pages.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="grid gap-4">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          subscriptions={subscriptions}
          update={(changes) => calls.update(profile.id, changes).then(onChanged)}
          remove={() => calls.remove(profile.id).then(onChanged)}
        />
      ))}
    </div>
  );
}

/**
 * The Access profiles tab: the person's named bundles of their subscriptions (a Claude one, an OpenAI one, a gateway),
 * the agents using each, New profile, and their default per company. `memberships` and `onDefaultChanged` are the
 * session's (the page passes them).
 */
export function ProfilesTab({
  memberships,
  onDefaultChanged,
}: {
  readonly memberships: readonly Membership[];
  readonly onDefaultChanged: () => Promise<unknown>;
}) {
  const api = useApi();
  const calls = useMemo(() => profileCalls(api), [api]);
  const profiles = useAccessProfiles();
  const subscriptions = useSubscriptions();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-dim">
          A profile is what you give an agent: which of your subscriptions its runs use. It never moves a
          subscription into a company.
        </p>
        {!creating && (
          <Button size="sm" tone="primary" icon={Plus} onClick={() => setCreating(true)}>
            New profile
          </Button>
        )}
      </div>
      {creating && (
        <NewProfileForm
          create={(name) =>
            calls.create({ name }).then(() => {
              setCreating(false);
              profiles.reload();
            })
          }
          onCancel={() => setCreating(false)}
        />
      )}
      <LoadState loaded={profiles} label="Loading your access profiles…" skeleton={SKELETON}>
        {(data) => (
          <ProfileList
            profiles={data.profiles}
            subscriptions={subscriptions.data?.subscriptions ?? []}
            calls={calls}
            onChanged={profiles.reload}
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

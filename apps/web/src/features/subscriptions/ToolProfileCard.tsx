import type { ToolRights } from '@mwc/shared/credentials';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { Card } from '../../components/ui/Card.tsx';
import { type CardProps, ProfileAgents, ProfileHeader, SavedSelect } from './ProfileParts.tsx';
import { subscriptionOptions } from './profile-options.ts';
import { ToolRightsFields } from './ToolRightsFields.tsx';

/** The profile's rights, each change saved at once as the whole set; a refusal shows under them and puts them back. */
function SavedRights({ profile, update }: Pick<CardProps, 'profile' | 'update'>) {
  const [rights, setRights] = useState<ToolRights | null>(profile.rights);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (rights === null) return null;
  const change = async (next: ToolRights) => {
    setRights(next);
    setBusy(true);
    setError(undefined);
    try {
      await update({ rights: next });
    } catch (failure) {
      setRights(profile.rights);
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <ToolRightsFields rights={rights} onChange={(next) => void change(next)} disabled={busy} />
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One GitHub or Atlassian profile (S7.1b): its name (renamed in place) with its tool's badge, its sign-in, its rights,
 * the agents that use it, and Delete, confirmed in place. Labels only; a change saves at once.
 */
export function ToolProfileCard({ profile, subscriptions, update, remove }: CardProps) {
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
      <ProfileHeader profile={profile} update={update} remove={remove} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SavedSelect
          label="Sign-in"
          value={profile.subscription?.id ?? ''}
          options={subscriptionOptions(profile.provider, subscriptions, profile.subscription)}
          save={(credentialId) => update({ credentialId })}
        />
      </div>
      <SavedRights key={profile.updatedAt} profile={profile} update={update} />
      <ProfileAgents agents={profile.agents} />
    </Card>
  );
}

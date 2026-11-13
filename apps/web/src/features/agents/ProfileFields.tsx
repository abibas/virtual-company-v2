import { useId } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfile, AgentDetail, AgentProfile } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { Field, SelectField, TextField } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { profileHarness, profileLabel, profileOption } from '../../components/org/agent-labels.ts';
import { Button } from '../../components/ui/Button.tsx';
import type { AgentDraft } from './agent-draft.ts';

/** The person's own access profiles, as the form loads them once. */
type MyProfiles = Loaded<{ readonly profiles: readonly AccessProfile[] }>;

/** The address of New profile on the person's profiles page. */
function newProfileHref(profilesHref: string): string {
  return `${profilesHref}${profilesHref.includes('?') ? '&' : '?'}new=1`;
}

/** The hint under the profile select: the profiles page, or Make one when the person has none. */
function ProfileHint({ count, error }: { readonly count: number | undefined; readonly error: unknown }) {
  const profilesHref = usePersonalHref('profiles');
  if (error !== undefined) return friendlyMessage(error);
  if (count === undefined) return null;
  return (
    <Link
      to={count === 0 ? newProfileHref(profilesHref) : profilesHref}
      className="font-semibold text-blue hover:underline"
    >
      {count === 0 ? 'Make one' : 'Your profiles'}
    </Link>
  );
}

/**
 * One of the signed-in person's own profiles, or None: each listed with its AI in short ("Work · Claude"); one without
 * an AI part is shown but not choosable ("No AI part"). Choosing one sets the agent's harness from its AI part.
 */
function MyProfileSelect({ draft, profiles }: { readonly draft: AgentDraft; readonly profiles: MyProfiles }) {
  const all = profiles.data?.profiles ?? [];
  const value = draft.values.profileId ?? '';
  const options = [
    { value: '', label: 'None' },
    ...all.map((p) => ({
      value: p.id,
      label: profileOption(p),
      disabled: profileHarness(p) === undefined && p.id !== value,
    })),
  ];
  if (value && !all.some((p) => p.id === value)) {
    options.push({
      value,
      label: profiles.data ? 'A profile that no longer exists' : 'Loading your profiles…',
    });
  }
  const choose = (profileId: string | null) => {
    draft.set('profileId', profileId);
    const chosen = all.find((p) => p.id === profileId);
    const harness = chosen && profileHarness(chosen);
    if (harness) draft.set('harness', harness);
  };
  return (
    <SelectField
      label="Profile"
      value={value}
      options={options}
      disabled={profiles.loading && profiles.data === undefined}
      onChange={(event) => choose(event.target.value || null)}
      hint={<ProfileHint count={profiles.data && all.length} error={profiles.error} />}
    />
  );
}

/** Someone else's profile: shown with its owner, not changeable here; an admin takes it off with Remove. */
function TheirProfile({
  profile,
  onRemove,
}: {
  readonly profile: AgentProfile;
  readonly onRemove: () => void;
}) {
  const id = useId();
  return (
    <Field label="Profile" id={id} hint="Someone else's profile.">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={profileLabel(profile)}
          readOnly
          aria-describedby={`${id}-hint`}
          className="flex-1"
        />
        <Button tone="quiet" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </Field>
  );
}

export interface ProfileProps {
  readonly draft: AgentDraft;
  readonly readOnly: boolean;
  /** The agent being edited; none for a new one. */
  readonly agent?: AgentDetail | undefined;
  readonly meUserId: string;
}

/**
 * The profile the agent runs on: an admin picks one of their own with an AI part (or None); an agent with someone
 * else's shows it with its owner and a Remove; everyone else reads it.
 */
export function ProfileChoice({
  draft,
  readOnly,
  agent,
  meUserId,
  profiles,
}: ProfileProps & { readonly profiles: MyProfiles }) {
  const current = agent?.profile;
  if (readOnly) return <TextField label="Profile" value={profileLabel(current ?? null)} readOnly />;
  if (current && current.ownerUserId !== meUserId && draft.values.profileId === current.id) {
    return <TheirProfile profile={current} onRemove={() => draft.set('profileId', null)} />;
  }
  return <MyProfileSelect draft={draft} profiles={profiles} />;
}

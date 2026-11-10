import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import { useId } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfile, AgentDetail, AgentProfile } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { Field, SelectField, TextField } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { profileLabel } from '../../components/org/agent-labels.ts';
import { Button } from '../../components/ui/Button.tsx';
import { PROVIDER_STYLES } from '../subscriptions/Providers.tsx';
import { profilesOf } from '../subscriptions/profile-options.ts';
import type { AgentDraft } from './agent-draft.ts';
import { followProvider } from './harness-from-profile.ts';

/** The person's own access profiles, as the form loads them once. */
type MyProfiles = Loaded<{ readonly profiles: readonly AccessProfile[] }>;

/** The address of New profile for a provider on the person's profiles page. */
function newProfileHref(profilesHref: string, provider: ProfileProvider): string {
  return `${profilesHref}${profilesHref.includes('?') ? '&' : '?'}new=${provider}`;
}

/** The hint under the profile select: what the profile decides, what runs the agent now, and the profiles page. */
function ProfileHint({
  harness,
  count,
  error,
}: {
  readonly harness: Harness;
  readonly count: number | undefined;
  readonly error: unknown;
}) {
  const profilesHref = usePersonalHref('profiles');
  if (error !== undefined) return friendlyMessage(error);
  const link = (
    <Link
      to={count === 0 ? newProfileHref(profilesHref, 'claude') : profilesHref}
      className="font-semibold text-blue hover:underline"
    >
      {count === 0 ? 'Make one' : 'Your access profiles'}
    </Link>
  );
  if (count === 0)
    return <>You have no access profile yet: the agent runs on one of your subscriptions. {link}</>;
  const runs = harness === 'codex' ? 'Codex' : 'Claude Code';
  return (
    <>
      The profile decides what runs it: a Claude profile runs Claude Code, an OpenAI profile runs Codex. Now:{' '}
      {runs}. {link}
    </>
  );
}

/** One of the signed-in person's own profiles, Claude's first then OpenAI's, or None; a pick sets the harness. */
function MyProfileSelect({ draft, profiles }: { readonly draft: AgentDraft; readonly profiles: MyProfiles }) {
  const all = profiles.data?.profiles ?? [];
  const ordered = [...profilesOf(all, 'claude'), ...profilesOf(all, 'openai')];
  const value = draft.values.profileId ?? '';
  const options = [
    { value: '', label: 'None' },
    ...ordered.map((p) => ({ value: p.id, label: `${p.name} · ${PROVIDER_STYLES[p.provider].name}` })),
  ];
  if (value && !ordered.some((p) => p.id === value)) {
    options.push({
      value,
      label: profiles.data ? 'A profile that no longer exists' : 'Loading your profiles…',
    });
  }
  const pick = (id: string) => {
    draft.set('profileId', id || null);
    const picked = all.find((p) => p.id === id);
    if (picked) followProvider(draft, picked.provider);
  };
  return (
    <SelectField
      label="Access profile"
      value={value}
      options={options}
      disabled={profiles.loading && profiles.data === undefined}
      onChange={(event) => pick(event.target.value)}
      hint={
        <ProfileHint
          harness={draft.values.harness}
          count={profiles.data && ordered.length}
          error={profiles.error}
        />
      }
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
    <Field label="Access profile" id={id} hint="Only its owner gives it to agents. You can take it off.">
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
 * Whose subscription the agent runs on: an admin picks one of their own access profiles of the provider its harness
 * runs on (or None); an agent with someone else's shows it with its owner and a Remove; everyone else reads it.
 */
export function ProfileChoice({
  draft,
  readOnly,
  agent,
  meUserId,
  profiles,
}: ProfileProps & { readonly profiles: MyProfiles }) {
  const current = agent?.profile;
  if (readOnly) return <TextField label="Access profile" value={profileLabel(current ?? null)} readOnly />;
  if (current && current.ownerUserId !== meUserId && draft.values.profileId === current.id) {
    return <TheirProfile profile={current} onRemove={() => draft.set('profileId', null)} />;
  }
  return <MyProfileSelect draft={draft} profiles={profiles} />;
}

import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
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
import type { AgentDraft, ProfileDefaults } from './agent-draft.ts';

/** The person's own access profiles, as the form loads them once. */
type MyProfiles = Loaded<{ readonly profiles: readonly AccessProfile[] }>;

/** The provider of a profile the form knows: one of the person's, or the agent's own; undefined when it does not. */
function providerOf(id: string, mine: readonly AccessProfile[], theirs: AgentProfile | null | undefined) {
  return (
    mine.find((profile) => profile.id === id)?.provider ?? (theirs?.id === id ? theirs.provider : undefined)
  );
}

/**
 * The profile a change of the form's harness leaves it with: a profile of the other provider is replaced by
 * the hirer's default of the new one (none on an agent's page, where saving takes it off); on the hire form, no
 * profile yet takes that default too. A profile the form cannot place yet (still loading) stays.
 */
export function profileForHarness(
  harness: Harness,
  current: string | null,
  known: { readonly mine: readonly AccessProfile[]; readonly agent?: AgentDetail | undefined },
  defaults: ProfileDefaults | undefined,
): string | null {
  const provider = HARNESS_PROVIDER[harness];
  if (current === null) return defaults?.[provider] ?? null;
  const held = providerOf(current, known.mine, known.agent?.profile);
  return held === undefined || held === provider ? current : (defaults?.[provider] ?? null);
}

/** The address of New profile for a provider on the person's profiles page. */
function newProfileHref(profilesHref: string, provider: ProfileProvider): string {
  return `${profilesHref}${profilesHref.includes('?') ? '&' : '?'}new=${provider}`;
}

/** The hint under the profile select: which profiles fit the harness, and Make one (New profile of that provider). */
function ProfileHint({
  provider,
  count,
  error,
}: {
  readonly provider: ProfileProvider;
  readonly count: number | undefined;
  readonly error: unknown;
}) {
  const profilesHref = usePersonalHref('profiles');
  if (error !== undefined) return friendlyMessage(error);
  const style = PROVIDER_STYLES[provider];
  const link = (
    <Link
      to={count === 0 ? newProfileHref(profilesHref, provider) : profilesHref}
      className="font-semibold text-blue hover:underline"
    >
      {count === 0 ? 'Make one' : 'Your access profiles'}
    </Link>
  );
  return count === 0 ? (
    <>
      You have no {style.name} profile yet, which {style.agents} run on. {link}
    </>
  ) : (
    <>
      Your {style.name} profiles: {style.agents} run on them. {link}
    </>
  );
}

/** One of the signed-in person's own profiles of the provider the harness runs on, or None. */
function MyProfileSelect({ draft, profiles }: { readonly draft: AgentDraft; readonly profiles: MyProfiles }) {
  const provider = HARNESS_PROVIDER[draft.values.harness];
  const all = profiles.data?.profiles ?? [];
  const fitting = profilesOf(all, provider);
  const value = draft.values.profileId ?? '';
  const options = [{ value: '', label: 'None' }, ...fitting.map((p) => ({ value: p.id, label: p.name }))];
  if (value && !fitting.some((p) => p.id === value)) {
    const other = all.find((p) => p.id === value);
    const label = other
      ? `${other.name} (for ${PROVIDER_STYLES[other.provider].name}: does not fit)`
      : profiles.data
        ? 'A profile that no longer exists'
        : 'Loading your profiles…';
    options.push({ value, label });
  }
  return (
    <SelectField
      label="Access profile"
      value={value}
      options={options}
      disabled={profiles.loading && profiles.data === undefined}
      onChange={(event) => draft.set('profileId', event.target.value || null)}
      hint={
        <ProfileHint provider={provider} count={profiles.data && fitting.length} error={profiles.error} />
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

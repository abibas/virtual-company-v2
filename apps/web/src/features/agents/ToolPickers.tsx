import type { ToolProvider } from '@mwc/shared/enums';
import type { AgentDetail } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { SelectField, TextField } from '../../components/forms/Field.tsx';
import { toolProfileLine } from '../../components/org/agent-labels.ts';
import { PROVIDER_STYLES } from '../subscriptions/Providers.tsx';
import { profilesOf } from '../subscriptions/profile-options.ts';
import type { AgentDraft } from './agent-draft.ts';
import { type MyProfiles, newProfileHref, type ProfileProps, TheirProfile } from './ProfileFields.tsx';

/** The draft's field and the agent's view of each tool's profile. */
const TOOL_FIELDS = {
  github: { column: 'githubProfileId', view: 'githubProfile' },
  atlassian: { column: 'atlassianProfileId', view: 'atlassianProfile' },
} as const satisfies Record<ToolProvider, { column: keyof AgentDraft['values']; view: keyof AgentDetail }>;

/** None, then the person's own profiles of the tool; with none yet, "Make one" opens New profile for it. */
function MyToolSelect({
  provider,
  draft,
  profiles,
}: {
  readonly provider: ToolProvider;
  readonly draft: AgentDraft;
  readonly profiles: MyProfiles;
}) {
  const profilesHref = usePersonalHref('profiles');
  const { column } = TOOL_FIELDS[provider];
  const mine = profilesOf(profiles.data?.profiles ?? [], provider);
  const value = draft.values[column] ?? '';
  const options = [{ value: '', label: 'None' }, ...mine.map((p) => ({ value: p.id, label: p.name }))];
  if (value && !mine.some((p) => p.id === value)) {
    options.push({
      value,
      label: profiles.data ? 'A profile that no longer exists' : 'Loading your profiles…',
    });
  }
  return (
    <SelectField
      label={PROVIDER_STYLES[provider].name}
      value={value}
      options={options}
      disabled={profiles.loading && profiles.data === undefined}
      onChange={(event) => draft.set(column, event.target.value || null)}
      hint={
        profiles.data &&
        mine.length === 0 && (
          <Link
            to={newProfileHref(profilesHref, provider)}
            className="font-semibold text-blue hover:underline"
          >
            Make one
          </Link>
        )
      }
    />
  );
}

/**
 * The agent's GitHub or Atlassian profile (S7.1b), beside its access profile: an admin picks one of their own of that
 * tool (or None); an agent with someone else's shows it with its owner and a Remove; everyone else reads it.
 */
export function ToolProfileChoice({
  provider,
  draft,
  readOnly,
  agent,
  meUserId,
  profiles,
}: ProfileProps & { readonly provider: ToolProvider; readonly profiles: MyProfiles }) {
  const { column, view } = TOOL_FIELDS[provider];
  const current = agent?.[view] ?? null;
  const label = PROVIDER_STYLES[provider].name;
  if (readOnly) return <TextField label={label} value={toolProfileLine(current)} readOnly />;
  if (current && current.ownerUserId !== meUserId && draft.values[column] === current.id) {
    return <TheirProfile label={label} profile={current} onRemove={() => draft.set(column, null)} />;
  }
  return <MyToolSelect provider={provider} draft={draft} profiles={profiles} />;
}

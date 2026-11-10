import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { Harness } from '@mwc/shared/enums';
import type { AccessProfile, Chat } from '../../../api/types.ts';
import { Select, type SelectOption } from '../../../components/forms/Input.tsx';
import { PROVIDER_STYLES } from '../../subscriptions/Providers.tsx';
import { useAction } from '../use-action.ts';

/** The agent's profile: the empty value, so choosing it sends `profileId: null`. */
const AGENTS = '';

/** The select in the header controls' look (`HEADER_CONTROL`): 32px, a full radius, the soft grey fill. */
const HEADER_SELECT =
  'w-auto max-w-56 [&_select]:h-8 [&_select]:rounded-full [&_select]:bg-surface-2 [&_select]:pr-8 [&_select]:pl-3 [&_select]:text-xs [&_select]:font-semibold [&_select]:text-ink-2 [&_select:hover]:bg-surface-3 [&>svg]:right-2.5 [&>svg]:size-3.5';

/**
 * The choices: the agent's own profile, then the person's own profiles of the provider the chat's harness runs on
 * (Claude for Claude Code, OpenAI for Codex), those without a subscription shown but not choosable; a profile of
 * someone else that the chat runs on stays listed as the current choice.
 */
export function profileOptions(
  harness: Harness,
  agentProfileName: string | null,
  mine: readonly AccessProfile[],
  current: string | null,
): readonly SelectOption[] {
  const provider = HARNESS_PROVIDER[harness];
  const fitting = mine.filter((profile) => profile.provider === provider);
  const group = `Your ${PROVIDER_STYLES[provider].name} profiles`;
  const options: SelectOption[] = [
    { value: AGENTS, label: `Agent's profile (${agentProfileName ?? 'none'})` },
    ...fitting.map((profile) => {
      const empty = profile.subscription === null;
      return {
        value: profile.id,
        label: empty ? `${profile.name} (no subscription)` : profile.name,
        disabled: empty,
        group,
      };
    }),
  ];
  if (current !== null && !fitting.some((profile) => profile.id === current)) {
    options.push({ value: current, label: "Another person's profile", disabled: true });
  }
  return options;
}

/**
 * Which access profile this chat's turns run on: the agent's, or one of the signed-in person's own (admins and owners;
 * the server lets only a profile's owner choose it). A change is saved at once; a refusal shows under the picker.
 */
export function ProfilePicker({
  chat,
  agentProfileName,
  profiles,
  canChange,
  onChange,
}: {
  readonly chat: Chat;
  readonly agentProfileName: string | null;
  /** The person's own access profiles; undefined while they load. */
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly canChange: boolean;
  readonly onChange: (profileId: string | null) => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const change = (value: string) => run(() => onChange(value === AGENTS ? null : value));
  return (
    <div className="relative min-w-0">
      <Select
        size="sm"
        aria-label="Access profile for this chat"
        title="The access profile this chat's turns run on"
        value={chat.profileId ?? AGENTS}
        options={profileOptions(chat.harness, agentProfileName, profiles ?? [], chat.profileId)}
        disabled={!canChange || busy || profiles === undefined}
        onChange={(event) => void change(event.target.value)}
        className={HEADER_SELECT}
      />
      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 z-30 mt-1.5 w-72 rounded-md bg-surface px-3 py-2 text-xs font-medium text-failed shadow-float ring-1 ring-line"
        >
          {error}
        </p>
      )}
    </div>
  );
}

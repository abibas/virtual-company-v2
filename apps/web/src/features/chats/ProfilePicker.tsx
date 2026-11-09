import type { Harness } from '@mwc/shared/enums';
import type { AccessProfile, Chat } from '../../api/types.ts';
import { Select, type SelectOption } from '../../components/forms/Input.tsx';
import { HARNESS_SLOT } from './chat-text.ts';
import { useAction } from './use-action.ts';

/** The agent's profile: the empty value, so choosing it sends `profileId: null`. */
const AGENTS = '';

/**
 * The choices: the agent's own profile, then the person's own profiles, those with nothing in the harness's slot shown
 * but not choosable; a profile of someone else that the chat runs on stays listed as the current choice.
 */
export function profileOptions(
  harness: Harness,
  agentProfileName: string | null,
  mine: readonly AccessProfile[],
  current: string | null,
): readonly SelectOption[] {
  const slot = HARNESS_SLOT[harness];
  const options: SelectOption[] = [
    { value: AGENTS, label: `Agent's profile (${agentProfileName ?? 'none'})` },
    ...mine.map((profile) => {
      const empty = profile[slot.key] === null;
      return {
        value: profile.id,
        label: empty ? `${profile.name} (no ${slot.name} subscription)` : profile.name,
        disabled: empty,
        group: 'Your access profiles',
      };
    }),
  ];
  if (current !== null && !mine.some((profile) => profile.id === current)) {
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
    <div className="grid min-w-0 gap-1">
      <Select
        size="sm"
        aria-label="Access profile for this chat"
        title="The access profile this chat's turns run on"
        value={chat.profileId ?? AGENTS}
        options={profileOptions(chat.harness, agentProfileName, profiles ?? [], chat.profileId)}
        disabled={!canChange || busy || profiles === undefined}
        onChange={(event) => void change(event.target.value)}
        className="w-auto max-w-72"
      />
      {error && (
        <p role="alert" className="max-w-72 text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { Effort, PermissionMode, ProfileProvider } from '@mwc/shared/enums';
import { catalogueModel, effortsOf } from '@mwc/shared/models';
import { chatRuns, DEFAULT_MODES, modeChoice, type Runs } from '@mwc/shared/modes';
import type { AccessProfile, AgentDetail, Chat, ChatDetail } from '../../../api/types.ts';
import { defaultModelLabel, effortLabel } from '../../../components/org/agent-labels.ts';

/**
 * A chat's own mode, model and effort in the composer (2026-11-13, docs/harness.md "Modes"): which chats offer them,
 * what the chat's profile runs, what its next turn runs (`chatRuns`, as the server reads it), and their words. Pure.
 */

/** A change of the chat's overrides, as `PATCH …/overrides` takes it: a value sets, null clears (the profile's). */
export interface OverridesPatch {
  readonly mode?: PermissionMode | null;
  readonly model?: string | null;
  readonly effort?: Effort | null;
}

/** A message chat: neither a task's conversation nor a flow's team chat (those run on their profile's). */
export const overridable = (chat: Pick<Chat, 'task' | 'flowId'>): boolean =>
  chat.task === null && chat.flowId === null;

/**
 * What the chat's profile runs: the agent's (its `runsWith`) when the chat has none of its own, the viewer's own
 * profile's part when it is theirs, else what the chat's detail said; null when none of them knows.
 */
export function profileRunsFor(
  chat: Pick<Chat, 'profileId' | 'harness'>,
  detail: ChatDetail['profileRuns'] | undefined,
  agent?: Pick<AgentDetail, 'runsWith'> | undefined,
  mine?: readonly AccessProfile[] | undefined,
): Runs | null {
  if (chat.profileId === null && agent?.runsWith) return agent.runsWith;
  const part = mine?.find((profile) => profile.id === chat.profileId)?.parts[HARNESS_PROVIDER[chat.harness]];
  return part ?? detail ?? null;
}

/** What the menus show: the chat's AI, the profile's runs, the chat's own, and what its next turn runs. */
export interface RunsView {
  readonly provider: ProfileProvider;
  readonly profile: Runs;
  readonly overrides: Chat['overrides'];
  readonly next: Runs;
}

export function runsView(chat: Pick<Chat, 'harness' | 'overrides'>, profile: Runs | null): RunsView {
  const provider = HARNESS_PROVIDER[chat.harness];
  const base = profile ?? { mode: DEFAULT_MODES[provider], model: null, effort: null };
  return {
    provider,
    profile: base,
    overrides: chat.overrides,
    next: chatRuns(provider, base, chat.overrides),
  };
}

/** A mode's label, or its short one for a narrow composer. */
export const modeWords = (provider: ProfileProvider, mode: PermissionMode, short = false): string => {
  const choice = modeChoice(provider, mode);
  return (short ? choice?.short : choice?.label) ?? mode;
};

/** A model's label ("Opus 5.5"), or the provider's default. */
export const modelWords = (provider: ProfileProvider, model: string | null): string =>
  model === null ? defaultModelLabel(provider) : (catalogueModel(model, provider)?.label ?? model);

/** An effort's word, or "Default effort". */
export const effortWords = (effort: Effort | null): string =>
  effort === null ? 'Default effort' : effortLabel(effort);

/** Choosing a model: the model, and the chat's effort cleared when the model it then runs does not take it. */
export function modelPatch(view: RunsView, model: string | null): OverridesPatch {
  const runs = model ?? view.profile.model;
  const effort = view.overrides.effort;
  const keeps = effort === null || effortsOf(view.provider, runs).includes(effort);
  return keeps ? { model } : { model, effort: null };
}

/** The efforts the model the next turn runs takes, low to high. */
export const effortChoices = (view: RunsView): readonly Effort[] => effortsOf(view.provider, view.next.model);

/**
 * What a turn ran with, in one quiet line for its footer ("Plan · Sonnet 5.5 · Low"): its mode, model and effort as
 * the turn recorded them (the model and effort left out when they were the harness's defaults); undefined for a turn
 * that recorded none (before 2026-11-13, a Clear, one not started).
 */
export function ranLine(turn: {
  readonly mode: PermissionMode | null;
  readonly model: string | null;
  readonly effort: Effort | null;
}): string | undefined {
  if (turn.mode === null) return undefined;
  const mode = (modeChoice('claude', turn.mode) ?? modeChoice('openai', turn.mode))?.label ?? turn.mode;
  const model = turn.model === null ? [] : [catalogueModel(turn.model)?.label ?? turn.model];
  const effort = turn.effort === null ? [] : [effortLabel(turn.effort)];
  return [mode, ...model, ...effort].join(' · ');
}

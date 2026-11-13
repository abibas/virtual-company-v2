import type { AiPartRow, Chat } from '@mwc/db';
import { PART_NAMES } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import type { TurnSpec } from '@mwc/shared/harness';
import { catalogueModel, effortsOf, MODEL_CATALOGUE } from '@mwc/shared/models';
import { chatRuns, isModeOf, MODES, NO_OVERRIDES, type Runs, type RunsOverrides } from '@mwc/shared/modes';
import { type Refusal, refuse } from '../rules.ts';

// A chat's own mode, model and effort for its next turns (2026-11-13, docs/harness.md "Modes"): only a message chat
// takes them (a task's step, a Lead's wake-up and a team room turn run on the profile's), each must fit the chat's AI (a
// mode of its harness, a model of its provider's catalogue, an effort that model takes), and a turn runs each override
// that fits, else the profile's (`chatRuns`). Pure.

export const OVERRIDES_UNSUPPORTED = refuse(
  409,
  'overrides_unsupported',
  "A task's or a team's conversation runs in its profile's mode and model: change them on the profile",
);

/** A message chat with an agent: neither a task's conversation nor a flow's team chat. */
export const takesOverrides = (chat: Pick<Chat, 'taskId' | 'flowId'>): boolean =>
  chat.taskId === null && chat.flowId === null;

/** The chat's overrides as stored. */
export const overridesOf = (chat: Pick<Chat, 'mode' | 'model' | 'effort'>): RunsOverrides => ({
  mode: chat.mode,
  model: chat.model,
  effort: chat.effort,
});

/** What a part runs as a turn reads it. */
export const partRuns = (part: AiPartRow): Runs => ({
  mode: part.mode,
  model: part.model,
  effort: part.effort,
});

/** What the chat's next turn runs on the part: its overrides in a message chat, else the part's own. */
export const turnRuns = (chat: Chat, provider: ProfileProvider, part: AiPartRow): Runs =>
  chatRuns(provider, partRuns(part), takesOverrides(chat) ? overridesOf(chat) : NO_OVERRIDES);

/** What a turn records it ran with: its spec's mode, model and effort (none: the harness's default). */
export const ranWith = (spec: Pick<TurnSpec, 'permissionMode' | 'model' | 'effort'>) => ({
  mode: spec.permissionMode ?? null,
  model: spec.model,
  effort: spec.effort ?? null,
});

const listed = (words: readonly string[]) => words.join(', ');

/** Whose modes a part's are: its harness's. */
const HARNESS_NAMES: Readonly<Record<ProfileProvider, string>> = { claude: 'Claude Code', openai: 'Codex' };

/**
 * Why these overrides do not fit the chat's `provider` part, or undefined: a mode of the other harness (422
 * `mode_unsupported`), a model not in the provider's catalogue (422 `model_unsupported`), an effort the model it runs
 * (the chat's, else the profile's) does not take (422 `effort_unsupported`).
 */
export function overridesRefusal(
  provider: ProfileProvider,
  after: RunsOverrides,
  profileModel: string | null,
): Refusal<422> | undefined {
  const name = PART_NAMES[provider];
  if (after.mode !== null && !isModeOf(provider, after.mode)) {
    const modes = listed(MODES[provider].map((mode) => mode.label));
    const harness = HARNESS_NAMES[provider];
    return refuse(422, 'mode_unsupported', `${after.mode} is not one of ${harness}'s modes: ${modes}`);
  }
  if (after.model !== null && catalogueModel(after.model, provider) === undefined) {
    const models = listed(MODEL_CATALOGUE[provider].map((model) => model.label));
    return refuse(422, 'model_unsupported', `${after.model} is not one of ${name}'s models: ${models}`);
  }
  const model = after.model ?? profileModel;
  const efforts = effortsOf(provider, model);
  if (after.effort !== null && !efforts.includes(after.effort)) {
    const who = (model === null ? undefined : catalogueModel(model, provider)?.label) ?? `${name}'s default`;
    return refuse(
      422,
      'effort_unsupported',
      `${who} takes the efforts ${listed(efforts)}, not ${after.effort}`,
    );
  }
  return undefined;
}

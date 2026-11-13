import { type AccessProfile, PROFILE_AI_COLUMNS, PROFILE_TOOL_COLUMNS } from '@mwc/db';
import {
  type AtlassianRights,
  defaultRights,
  type GitHubRights,
  PART_NAMES,
  PROFILE_PROVIDERS,
  TOOL_PROVIDERS,
} from '@mwc/shared/credentials';
import type { Effort, PermissionMode, ProfileProvider } from '@mwc/shared/enums';
import { DEFAULT_MODES } from '@mwc/shared/modes';
import { A_PROVIDER, type ProfileChange, type ProfileRefusal, type ProfileRuns, refuse } from './profiles.ts';

// A profile's parts (generic profiles since 2026-11-13, docs/subscriptions.md "Profiles"): what a request's `parts`
// write to the profile's columns, which AI parts a change removes or makes run something new, the refusal of a second AI
// part (one at most since 2026-11-13) and of removing a part agents run on. Which credential fits each place is `credentialRefusal`'s (`profiles.ts`), the rights'
// shape `@mwc/shared/credentials`' (the request's schema parses them). Pure.

/**
 * An AI part as a request gives it: its subscription, gateway, model, effort and mode, each optional (the request's
 * schema takes only the part's own modes).
 */
interface AiPartChoice {
  readonly credentialId?: string | null | undefined;
  readonly gatewayCredentialId?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly effort?: Effort | null | undefined;
  readonly mode?: PermissionMode | undefined;
}

/** A tool part as a request gives it: its sign-in and its whole rights, each optional. */
interface ToolPartChoice<R> {
  readonly credentialId?: string | null | undefined;
  readonly rights?: R | undefined;
}

/** A profile's parts as a request gives them: a part to add or change, null to remove it, or left out to keep it. */
export interface PartsChoice {
  readonly claude?: AiPartChoice | null | undefined;
  readonly openai?: AiPartChoice | null | undefined;
  readonly github?: ToolPartChoice<GitHubRights> | null | undefined;
  readonly atlassian?: ToolPartChoice<AtlassianRights> | null | undefined;
}

type Stored = Pick<AccessProfile, Exclude<keyof ProfileChange, 'name'>>;

/** The columns one AI part's choice writes on a profile as stored (none for a new one). */
function aiColumns(provider: ProfileProvider, before: Stored | undefined, choice: AiPartChoice | null) {
  const at = PROFILE_AI_COLUMNS[provider];
  const has = before?.[at.part] === true;
  if (choice === null) {
    return has
      ? {
          [at.part]: false,
          [at.credential]: null,
          [at.gateway]: null,
          [at.model]: null,
          [at.effort]: null,
          [at.mode]: null,
        }
      : {};
  }
  const fields = [
    [at.credential, choice.credentialId],
    [at.gateway, choice.gatewayCredentialId],
    [at.model, choice.model],
    [at.effort, choice.effort],
  ] as const;
  const set: Record<string, unknown> = has ? {} : { [at.part]: true };
  for (const [column, value] of fields) if (value !== undefined || !has) set[column] = value ?? null;
  if (choice.mode !== undefined || !has) set[at.mode] = choice.mode ?? DEFAULT_MODES[provider];
  return set;
}

/** The columns one tool part's choice writes on a profile as stored (none for a new one). */
function toolColumns(
  tool: (typeof TOOL_PROVIDERS)[number],
  before: Stored | undefined,
  choice: ToolPartChoice<unknown> | null,
) {
  const at = PROFILE_TOOL_COLUMNS[tool];
  const has = before !== undefined && before[at.rights] !== null;
  if (choice === null) return has ? { [at.credential]: null, [at.rights]: null } : {};
  const set: Record<string, unknown> = {};
  if (choice.credentialId !== undefined || !has) set[at.credential] = choice.credentialId ?? null;
  if (choice.rights !== undefined || !has) set[at.rights] = choice.rights ?? defaultRights(tool);
  return set;
}

/**
 * The columns a request's parts write, on a profile as stored (none for a new one): a part removed (null) empties its
 * columns, when the profile has it; a part added takes what it gives, the rest empty (an AI part's mode its default,
 * Manual or Ask; a tool part's rights its tool's safe defaults); a part changed takes what it gives, keeping what is left out. A part left out writes nothing.
 * `profileChanges` then drops what equals the stored values.
 */
export function partColumns(before: Stored | undefined, parts: PartsChoice | undefined): ProfileChange {
  const set: Record<string, unknown> = {};
  for (const provider of PROFILE_PROVIDERS) {
    const choice = parts?.[provider];
    if (choice !== undefined) Object.assign(set, aiColumns(provider, before, choice));
  }
  for (const tool of TOOL_PROVIDERS) {
    const choice = parts?.[tool];
    if (choice !== undefined) Object.assign(set, toolColumns(tool, before, choice));
  }
  return set as ProfileChange;
}

/** The AI parts a change removes from a profile as stored. */
export const removedAiParts = (before: Stored, set: ProfileChange): ProfileProvider[] =>
  PROFILE_PROVIDERS.filter(
    (provider) =>
      before[PROFILE_AI_COLUMNS[provider].part] && set[PROFILE_AI_COLUMNS[provider].part] === false,
  );

/**
 * The AI parts a change makes run something new, with what they run after it (to check against the catalogue): each
 * part there after the change whose model or effort the change sets.
 */
export function runsAfterChange(
  before: Stored | undefined,
  set: ProfileChange,
): Array<readonly [ProfileProvider, ProfileRuns]> {
  return PROFILE_PROVIDERS.flatMap((provider) => {
    const at = PROFILE_AI_COLUMNS[provider];
    const present = set[at.part] ?? before?.[at.part] ?? false;
    if (!present || (set[at.model] === undefined && set[at.effort] === undefined)) return [];
    const model = set[at.model] === undefined ? (before?.[at.model] ?? null) : set[at.model];
    const effort = set[at.effort] === undefined ? (before?.[at.effort] ?? null) : set[at.effort];
    return [[provider, { model: model ?? null, effort: effort ?? null }] as const];
  });
}

/**
 * A change that leaves a profile with both AI parts (422 `one_ai_part`, since 2026-11-13: a profile runs one AI, and an
 * agent's harness follows it), or undefined. A swap in one change (one part removed, the other added) is fine.
 */
export function secondAiPart(
  before: Stored | undefined,
  set: ProfileChange,
): ProfileRefusal<422> | undefined {
  const after = (provider: ProfileProvider) => {
    const at = PROFILE_AI_COLUMNS[provider].part;
    return set[at] ?? before?.[at] ?? false;
  };
  if (!after('claude') || !after('openai')) return undefined;
  const had = PROFILE_PROVIDERS.find((provider) => before?.[PROFILE_AI_COLUMNS[provider].part] === true);
  return refuse(
    422,
    'one_ai_part',
    had === undefined
      ? 'A profile runs one AI: give it a Claude part or an OpenAI part, not both'
      : `This profile already has ${A_PROVIDER[had]} part; a profile runs one AI`,
  );
}

/** Names in a sentence: "a", "a and b", "a, b and c". */
const sentence = (names: readonly string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Removing an AI part agents run on (422 `profile_part_in_use`), naming them. */
export const partInUse = (provider: ProfileProvider, agents: readonly string[]): ProfileRefusal<422> =>
  refuse(
    422,
    'profile_part_in_use',
    `${sentence(agents)} ${agents.length === 1 ? 'runs' : 'run'} on this profile's ${PART_NAMES[provider]} part: give ${agents.length === 1 ? 'it' : 'them'} another profile first`,
  );

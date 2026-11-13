import {
  PART_NAMES,
  PROFILE_PROVIDERS,
  rightsSummary,
  TOOL_PROVIDERS,
  type ToolRights,
} from '@mwc/shared/credentials';
import type { Effort, Harness, ProfileProvider, ToolProvider } from '@mwc/shared/enums';
import { catalogueModel, effortsOf } from '@mwc/shared/models';
import type { AccessProfile, Agent, AgentProfile } from '../../api/types.ts';
import type { AgentRef } from '../feed/kinds.ts';
import type { SegmentOption } from '../forms/Segmented.tsx';

/** Each provider's name, as the model and effort lines say it ("Claude's default"). */
const PROVIDER_WORDS: Readonly<Record<ProfileProvider, string>> = { claude: 'Claude', openai: 'OpenAI' };

/** What a profile with no model runs: "Claude's default", "OpenAI's default". */
export const defaultModelLabel = (provider: ProfileProvider): string =>
  `${PROVIDER_WORDS[provider]}'s default`;

/** A model as people read it: "Opus 5.5" for one of the catalogue's, the id itself for another. */
export function modelLabel(model: string): string {
  return catalogueModel(model)?.label ?? model;
}

const EFFORT_WORDS: Readonly<Record<Effort, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
  ultra: 'Ultra',
};

/** How hard a profile's runs think, as people read it. */
export const effortLabel = (effort: Effort): string => EFFORT_WORDS[effort];

/** The levels a profile of `provider` may run `model` at, low to high, for a segmented control. */
export function effortOptions(
  provider: ProfileProvider,
  model: string | null,
): readonly SegmentOption<Effort>[] {
  return effortsOf(provider, model).map((value) => ({ value, label: EFFORT_WORDS[value] }));
}

const HARNESS_WORDS: Readonly<Record<Harness, string>> = { claude_code: 'Claude Code', codex: 'Codex' };

/** What runs the agent, as people read it. */
export const harnessLabel = (harness: Harness): string => HARNESS_WORDS[harness];

/** What an agent runs: its access profile's model and effort (null each for the provider's default). */
export type RunsWith = NonNullable<Agent['runsWith']>;

/** The model a profile runs as people read it: its label, or the provider's default. */
export const runsModelLabel = (runs: Pick<RunsWith, 'model' | 'provider'>): string =>
  runs.model === null ? defaultModelLabel(runs.provider) : modelLabel(runs.model);

/** The effort a profile runs at as people read it: its level, or the default. */
export const runsEffortLabel = (effort: Effort | null): string =>
  effort === null ? 'Default effort' : effortLabel(effort);

/**
 * What an agent runs in one short line ("Opus 5.5 · High", "OpenAI's default · Default effort"), its access profile's
 * model and effort, the small type of a card or a row; "No profile" without one.
 */
export const runsLine = (runs: RunsWith | null): string =>
  runs === null ? 'No profile' : `${runsModelLabel(runs)} · ${runsEffortLabel(runs.effort)}`;

/** The access profile an agent's runs use, with its owner ("Work · Ihor Herasko"), or "None". */
export const profileLabel = (
  profile: Pick<NonNullable<Agent['profile']>, 'name' | 'ownerName'> | null,
): string => (profile ? `${profile.name} · ${profile.ownerName}` : 'None');

/** A profile's parts as the line reads them: the person's own profile's or as an agent shows it. */
type Parts = AccessProfile['parts'] | AgentProfile['parts'];

/** One AI part in short: "Claude", with its model and effort when not the defaults ("Claude · Opus 5.5 · High"). */
function aiWords(
  provider: ProfileProvider,
  part: { readonly model: string | null; readonly effort: Effort | null },
) {
  const model = part.model === null ? [] : [modelLabel(part.model)];
  const effort = part.effort === null ? [] : [effortLabel(part.effort)];
  return [PART_NAMES[provider], ...model, ...effort].join(' · ');
}

/** One tool part in short: "GitHub: push, PRs · AiriaLLC/*", or "GitHub: no sign-in". */
function toolWords(tool: ToolProvider, part: { readonly rights: ToolRights } & object) {
  const signedIn = 'signIn' in part ? part.signIn !== null : 'account' in part && part.account !== null;
  return `${PART_NAMES[tool]}: ${signedIn ? rightsSummary(part.rights) : 'no sign-in'}`;
}

/**
 * A profile's parts in one compact line (generic profiles since 2026-11-13), in their fixed order: each AI part with its
 * model and effort when not the defaults, then each tool part's rights in short ("Claude · Opus 5.5 · High · GitHub:
 * push, PRs · AiriaLLC/* · Atlassian: Jira read (AP) · Confluence write"); never a subscription or its account.
 */
export function profileLine(profile: { readonly parts: Parts }): string {
  const { parts } = profile;
  const ai = PROFILE_PROVIDERS.flatMap((provider) => {
    const part = parts[provider];
    return part === null ? [] : [aiWords(provider, part)];
  });
  const tools = TOOL_PROVIDERS.flatMap((tool) => {
    const part = parts[tool];
    return part === null ? [] : [toolWords(tool, part)];
  });
  const pieces = [...ai, ...tools];
  return pieces.length === 0 ? 'No parts' : pieces.join(' · ');
}

/** A profile's one AI part (one at most since 2026-11-13), which decides an agent's harness; undefined for none. */
export const profileAiPart = (profile: { readonly parts: Parts }): ProfileProvider | undefined =>
  PROFILE_PROVIDERS.find((provider) => profile.parts[provider] !== null);

/** The harness each AI part runs: Claude Code on a Claude part, Codex on an OpenAI part. */
const PART_HARNESS: Readonly<Record<ProfileProvider, Harness>> = { claude: 'claude_code', openai: 'codex' };

/** The harness a profile gives the agents it is given to; undefined for a profile without an AI part. */
export function profileHarness(profile: { readonly parts: Parts }): Harness | undefined {
  const part = profileAiPart(profile);
  return part === undefined ? undefined : PART_HARNESS[part];
}

/** A profile as an agent form's picker lists it: its name and its AI in short ("Work · Claude"), or "No AI part". */
export function profileOption(profile: { readonly name: string; readonly parts: Parts }): string {
  const part = profileAiPart(profile);
  return `${profile.name} · ${part === undefined ? 'No AI part' : PART_NAMES[part]}`;
}

/** An agent as the feed and the quick-create dock show it: its name, its role and its drawn face. */
export function agentRef(agent: Pick<Agent, 'id' | 'name' | 'roleTitle' | 'face'>): AgentRef {
  return { id: agent.id, name: agent.name, role: agent.roleTitle, face: agent.face };
}

import { rightsSummary, TOOL_PROVIDERS, type ToolRights } from '@mwc/shared/credentials';
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

/** The harnesses: Claude Code now, Codex shown and kept for later (S7). */
export const HARNESS_OPTIONS: readonly SegmentOption<Harness>[] = [
  { value: 'claude_code', label: HARNESS_WORDS.claude_code },
  { value: 'codex', label: HARNESS_WORDS.codex },
];

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

const TOOL_WORDS: Readonly<Record<ToolProvider, string>> = { github: 'GitHub', atlassian: 'Atlassian' };

/** A tool part as the line reads it: whether its sign-in is there, and its rights. */
interface PartWords {
  readonly signedIn: boolean;
  readonly rights: ToolRights;
}

/** A profile's parts, from the person's own profile (`AccessProfile`) or as an agent shows it (`AgentProfile`). */
function partsOf(profile: AccessProfile | AgentProfile) {
  const own = 'subscription' in profile;
  const account = own ? (profile.subscription?.accountEmail ?? null) : profile.account;
  const part = (tool: ToolProvider): PartWords | null => {
    const held = profile.tools[tool];
    if (held === null) return null;
    return { signedIn: 'signIn' in held ? held.signIn !== null : held.account !== null, rights: held.rights };
  };
  return { account, tools: TOOL_PROVIDERS.map((tool) => [tool, part(tool)] as const) };
}

/**
 * A profile's parts in one compact line (S7.1b, one profile since 2026-11-13): its provider, the model and effort it
 * runs (`runs`: the person's own profile itself, or the agent's `runsWith`) when not the defaults, its subscription's account, then each tool part's rights in short ("Claude · Opus 5.5 ·
 * High · ihor@airia.ai · GitHub: push, PRs · AiriaLLC/* · Atlassian: Jira read · Confluence write"); a part without a
 * sign-in says so.
 */
export function profileLine(
  profile: AccessProfile | AgentProfile,
  runs: Pick<RunsWith, 'model' | 'effort'> | null,
): string {
  const { account, tools } = partsOf(profile);
  const model = runs?.model ?? null;
  const effort = runs?.effort ?? null;
  const parts = tools.flatMap(([tool, part]) => {
    if (part === null) return [];
    return [`${TOOL_WORDS[tool]}: ${part.signedIn ? rightsSummary(part.rights) : 'no sign-in'}`];
  });
  return [
    PROVIDER_WORDS[profile.provider],
    model === null ? null : modelLabel(model),
    effort === null ? null : effortLabel(effort),
    account,
    ...parts,
  ]
    .filter((piece) => piece !== null && piece !== '')
    .join(' · ');
}

/** An agent as the feed and the quick-create dock show it: its name, its role and its drawn face. */
export function agentRef(agent: Pick<Agent, 'id' | 'name' | 'roleTitle' | 'face'>): AgentRef {
  return { id: agent.id, name: agent.name, role: agent.roleTitle, face: agent.face };
}

import type { Effort, Harness, ProfileProvider } from '@mwc/shared/enums';
import { catalogueModel, effortsOf } from '@mwc/shared/models';
import type { Agent } from '../../api/types.ts';
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

/** What each level does, as the effort control's hint says it (Codex's own words for its levels). */
export const EFFORT_HINTS: Readonly<Record<Effort, string>> = {
  low: 'Fast answers with lighter reasoning.',
  medium: 'Balances speed and depth for everyday tasks.',
  high: 'Deeper reasoning for complex problems; suits most work.',
  xhigh: 'Extra-deep reasoning for complex problems.',
  max: 'The deepest reasoning, for the hardest problems; costs the most.',
  ultra: 'The deepest reasoning, and it hands parts of the task to helpers.',
};

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
export const profileLabel = (profile: Agent['profile']): string =>
  profile ? `${profile.name} · ${profile.ownerName}` : 'None';

/** An agent as the feed and the quick-create dock show it: its name, its role and its drawn face. */
export function agentRef(agent: Pick<Agent, 'id' | 'name' | 'roleTitle' | 'face'>): AgentRef {
  return { id: agent.id, name: agent.name, role: agent.roleTitle, face: agent.face };
}

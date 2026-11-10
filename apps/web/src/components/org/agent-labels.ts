import { Effort, type Harness } from '@mwc/shared/enums';
import type { Agent } from '../../api/types.ts';
import type { AgentRef } from '../feed/kinds.ts';
import type { SegmentOption } from '../forms/Segmented.tsx';

/** The models the agent form offers by name; any other id is a custom model, shown as it is. */
export const MODELS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { value: 'claude-fable-5-1', label: 'Fable 5.1' },
];

/** The models offered for a Codex agent: Codex's own default (from its config and the subscription's plan). */
export const CODEX_MODELS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'codex-default', label: "Codex's default model" },
];

/** A model as people read it: "Opus 5.5" for a known id, the id itself for a custom one. */
export function modelLabel(model: string): string {
  return [...MODELS, ...CODEX_MODELS].find((known) => known.value === model)?.label ?? model;
}

const EFFORT_WORDS: Readonly<Record<Effort, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
};

/** How hard the agent thinks, as people read it. */
export const effortLabel = (effort: Effort): string => EFFORT_WORDS[effort];

/** The efforts in their order, low to max, for a segmented control. */
export const EFFORT_OPTIONS: readonly SegmentOption<Effort>[] = Effort.options.map((value) => ({
  value,
  label: EFFORT_WORDS[value],
}));

const HARNESS_WORDS: Readonly<Record<Harness, string>> = { claude_code: 'Claude Code', codex: 'Codex' };

/** What runs the agent, as people read it. */
export const harnessLabel = (harness: Harness): string => HARNESS_WORDS[harness];

/** The harnesses: Claude Code now, Codex shown and kept for later (S7). */
export const HARNESS_OPTIONS: readonly SegmentOption<Harness>[] = [
  { value: 'claude_code', label: HARNESS_WORDS.claude_code },
  { value: 'codex', label: HARNESS_WORDS.codex },
];

/** The model and the effort in one short line ("Opus 5.5 · High"), the small type of a card or a row. */
export const modelLine = (model: string, effort: Effort): string =>
  `${modelLabel(model)} · ${effortLabel(effort)}`;

/** The access profile an agent's runs use, with its owner ("Work · Ihor Herasko"), or "None". */
export const profileLabel = (profile: Agent['profile']): string =>
  profile ? `${profile.name} · ${profile.ownerName}` : 'None';

/** An agent as the feed and the quick-create dock show it: its name, its role and its drawn face. */
export function agentRef(agent: Pick<Agent, 'id' | 'name' | 'roleTitle' | 'face'>): AgentRef {
  return { id: agent.id, name: agent.name, role: agent.roleTitle, face: agent.face };
}

import type { AiProvider } from '../enums.ts';
import { CODEX_LARGE_WINDOW, CODEX_WINDOW, catalogueModel, DEFAULT_WINDOWS } from '../models.ts';

/**
 * The context window of a model (docs/harness.md, "Events"), for a turn's `context` event when the harness does not
 * report it: Claude Code reports it only at the turn's end (`result.modelUsage[].contextWindow`), and Codex only in its
 * session file, which the runner reads at the turn's end (docs/harness.md, "Codex's context reading").
 * The model catalogue's own window first (`@mwc/shared/models`), else the longest matching prefix below; an id naming
 * a 1M window (`[1m]`) is 1M; unknown models are null.
 */

const MILLION = 1_000_000;

/**
 * Model id prefixes and their windows: Anthropic's models list (2026-10) and Claude Code's aliases, which name the
 * current models; OpenAI's models as Codex shows them (95% of their `context_window`: 475k for GPT-6.1, 258.4k for the
 * rest of the GPT-6 and GPT-5 families).
 */
export const CONTEXT_WINDOWS: readonly (readonly [prefix: string, window: number])[] = [
  ['claude-fable-5', MILLION],
  ['claude-mythos-5', MILLION],
  ['claude-opus-5', MILLION],
  ['claude-sonnet-5', MILLION],
  ['claude-haiku-5', MILLION],
  ['claude-opus-4-8', MILLION],
  ['claude-opus-4-7', MILLION],
  ['claude-opus-4-6', MILLION],
  ['claude-sonnet-4-6', MILLION],
  ['claude-opus-4', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-haiku-4', 200_000],
  ['fable', MILLION],
  ['opus', MILLION],
  ['sonnet', MILLION],
  ['haiku', MILLION],
  ['gpt-6.1', CODEX_LARGE_WINDOW],
  ['gpt-6', CODEX_WINDOW],
  ['gpt-5', CODEX_WINDOW],
  ['gpt-4.1', 1_047_576],
  ['o3', 200_000],
  ['o4-mini', 200_000],
  ['codex-mini', 200_000],
  ['gpt-oss', 131_072],
];

/** Provider prefixes in front of a model id: Bedrock's (`us.anthropic.`), a router's (`openai/`). */
const PROVIDER_PREFIX = /^(?:[a-z]{2,6}\.)?anthropic\.|^(?:anthropic|openai)\//;

/** The model's context window in tokens; null for no model or one this table does not know. */
export function contextWindowOf(model: string | null | undefined): number | null {
  const id = model?.trim().toLowerCase().replace(PROVIDER_PREFIX, '') ?? '';
  if (id === '') return null;
  if (id.includes('[1m]')) return MILLION;
  const known = catalogueModel(id);
  if (known) return known.window;
  let best: readonly [string, number] | undefined;
  for (const entry of CONTEXT_WINDOWS) {
    if (id.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1] ?? null;
}

/**
 * The window of what an access profile runs: its model's (`contextWindowOf`), or for none (the provider's default) the
 * window every current model of its provider has.
 */
export function profileWindowOf(provider: AiProvider, model: string | null | undefined): number | null {
  return model == null ? DEFAULT_WINDOWS[provider] : contextWindowOf(model);
}

/**
 * How full a window is, 0–100 rounded, as the harness itself shows it: with a `baseline` (Codex's 12k of instructions
 * and tools it never counts against the conversation, docs/harness.md, "Codex's context reading") the share of the
 * window past it, as Codex's `/status` ("95% left"); undefined without a window.
 */
export function contextPercent(used: number, window: number | null, baseline = 0): number | undefined {
  if (!window) return undefined;
  const room = window - baseline;
  if (room <= 0) return 100;
  return Math.round((Math.max(0, used - baseline) / room) * 100);
}

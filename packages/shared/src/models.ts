import { z } from 'zod';
import { Effort, type ProfileProvider } from './enums.ts';

/**
 * The model catalogue (docs/subscriptions.md, "Model and effort"): for each provider of an access profile, the models
 * it offers by name, each with its context window and the reasoning efforts it takes, and the provider's own levels. A
 * profile names one of these, another id typed in, or none: the provider's default, which its harness picks.
 *
 * Claude's are Anthropic's Claude 5 family (its models list, 2026-11): a 1M window each and the five levels Claude
 * Code's `--effort` takes. OpenAI's are the models Codex 0.162.1 lists for a ChatGPT sign-in (the model presets
 * compiled into its binary, those it shows, in its order), with the levels each takes (`model_reasoning_effort`) and
 * the 272k window Codex gives them (its `context_window`). A profile's effort is one of its model's levels, or of its
 * provider's for a typed-in model or the default.
 */

/** The longest model id the API takes (`access_profiles_model_check`), on a command line too. */
export const MODEL_ID_MAX = 100;

/** A model id or alias (`opus`, `claude-opus-5-5[1m]`, `gpt-6.1-sol`): one word that cannot be read as an option. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;

/** A model id as the API and the runner protocol take it. */
export const ModelId = z.string().min(1).max(MODEL_ID_MAX).regex(MODEL_ID_PATTERN, 'a model id');

/** Claude Code's levels (`--effort`). */
export const ClaudeEffort = Effort.extract(['low', 'medium', 'high', 'xhigh', 'max']);
export type ClaudeEffort = z.infer<typeof ClaudeEffort>;

/** Codex's levels (`model_reasoning_effort`) that its listed models take; `ultra` also hands work to helpers. */
export const OpenaiEffort = Effort.extract(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type OpenaiEffort = z.infer<typeof OpenaiEffort>;

/** Each provider's levels, low to high. */
export const PROVIDER_EFFORTS: Readonly<Record<ProfileProvider, readonly Effort[]>> = {
  claude: ClaudeEffort.options,
  openai: OpenaiEffort.options,
};

/** A model a provider offers by name. */
export interface CatalogueModel {
  readonly id: string;
  /** How people read it ("Opus 5.5", "GPT-6.1 Sol"). */
  readonly label: string;
  /** Its context window in tokens, as its harness sizes it. */
  readonly window: number;
  /** The efforts it takes, low to high. */
  readonly efforts: readonly Effort[];
}

const MILLION = 1_000_000;
const CODEX_WINDOW = 272_000;
const UP_TO_MAX = OpenaiEffort.exclude(['ultra']).options;
const UP_TO_XHIGH = OpenaiEffort.exclude(['max', 'ultra']).options;

const claude = (id: string, label: string): CatalogueModel => ({
  id,
  label,
  window: MILLION,
  efforts: ClaudeEffort.options,
});

const openai = (id: string, label: string, efforts: readonly Effort[] = OpenaiEffort.options) => ({
  id,
  label,
  window: CODEX_WINDOW,
  efforts,
});

/** The models each provider offers by name, in the order the forms list them. */
export const MODEL_CATALOGUE: Readonly<Record<ProfileProvider, readonly CatalogueModel[]>> = {
  claude: [
    claude('claude-opus-5-5', 'Opus 5.5'),
    claude('claude-sonnet-5-5', 'Sonnet 5.5'),
    claude('claude-haiku-5-5', 'Haiku 5.5'),
    claude('claude-fable-5-1', 'Fable 5.1'),
  ],
  openai: [
    openai('gpt-6.1-sol', 'GPT-6.1 Sol'),
    openai('gpt-6-astra', 'GPT-6 Astra'),
    openai('gpt-6-sol', 'GPT-6 Sol'),
    openai('gpt-6-luna', 'GPT-6 Luna', UP_TO_MAX),
    openai('gpt-5.6-sol', 'GPT-5.6 Sol'),
    openai('gpt-5.6-terra', 'GPT-5.6 Terra'),
    openai('gpt-5.6-luna', 'GPT-5.6 Luna', UP_TO_MAX),
    openai('gpt-5.5', 'GPT-5.5', UP_TO_XHIGH),
  ],
};

/** The window of a profile that names no model: every current model of the provider has it. */
export const DEFAULT_WINDOWS: Readonly<Record<ProfileProvider, number>> = {
  claude: MILLION,
  openai: CODEX_WINDOW,
};

const normal = (id: string) => id.trim().toLowerCase();

/** The catalogue's model of this id (any case), of one provider or of either; undefined for another id. */
export function catalogueModel(id: string, provider?: ProfileProvider): CatalogueModel | undefined {
  const wanted = normal(id);
  const providers = provider === undefined ? (['claude', 'openai'] as const) : [provider];
  for (const each of providers) {
    const found = MODEL_CATALOGUE[each].find((model) => model.id === wanted);
    if (found) return found;
  }
  return undefined;
}

/** Ids that name a Claude model (its ids and Claude Code's aliases) or an OpenAI one (GPT, the o-series, Codex's). */
const PROVIDER_IDS: readonly (readonly [ProfileProvider, RegExp])[] = [
  ['claude', /^(?:claude|opus|sonnet|haiku|fable)/],
  ['openai', /^(?:gpt-|o\d|codex-)/],
];

/** The provider whose model an id names, by the catalogue and the id's own prefix; null when it does not say. */
export function modelProvider(id: string): ProfileProvider | null {
  const wanted = normal(id);
  for (const [provider, pattern] of PROVIDER_IDS) if (pattern.test(wanted)) return provider;
  return null;
}

/** The efforts a profile of `provider` may run `model` at: the model's own when the catalogue knows it, else the provider's. */
export function effortsOf(provider: ProfileProvider, model: string | null): readonly Effort[] {
  const known = model === null ? undefined : catalogueModel(model, provider);
  return known?.efforts ?? PROVIDER_EFFORTS[provider];
}

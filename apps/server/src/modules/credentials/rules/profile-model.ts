import type { AiProvider, Effort } from '@mwc/shared/enums';
import { catalogueModel, effortsOf, modelProvider } from '@mwc/shared/models';
import { A_PROVIDER, capital, type ProfileRefusal, type ProfileRuns, refuse } from './profiles.ts';

// What an access profile may run (since 2026-11-10, docs/subscriptions.md "Model and effort"): a model of its own
// provider (one of the catalogue's, or another id that is not plainly the other provider's) and an effort its model
// takes (a catalogue model's own levels, else the provider's). Only AI profiles run anything: a tool profile has
// neither (`tool-profiles.ts`). Pure.

const PROVIDER_NAMES: Readonly<Record<AiProvider, string>> = { claude: 'Claude', openai: 'OpenAI' };

/** A model of the other provider than the profile's (422 `model_provider_mismatch`). */
const modelProviderMismatch = (model: string, provider: AiProvider, other: AiProvider) =>
  refuse(
    422,
    'model_provider_mismatch',
    `${model} is ${A_PROVIDER[other]} model; ${A_PROVIDER[provider]} profile runs ${PROVIDER_NAMES[provider]}'s models`,
  );

/** An effort the model (or, without a known one, the provider) does not take (422 `effort_unsupported`). */
function effortUnsupported(provider: AiProvider, model: string | null, effort: Effort) {
  const known = model === null ? undefined : catalogueModel(model, provider);
  const who =
    known?.label ?? (model === null ? `${PROVIDER_NAMES[provider]}'s default` : PROVIDER_NAMES[provider]);
  const levels = effortsOf(provider, model).join(', ');
  return refuse(422, 'effort_unsupported', `${capital(who)} takes the efforts ${levels}, not ${effort}`);
}

/**
 * Why a `provider` profile may not run this model at this effort (each null for the provider's default), or undefined
 * when it may: a model of the other provider (422 `model_provider_mismatch`), an effort its model does not take (422
 * `effort_unsupported`).
 */
export function runsRefusal(provider: AiProvider, runs: ProfileRuns): ProfileRefusal<422> | undefined {
  const { model, effort } = runs;
  const other = model === null ? null : modelProvider(model);
  if (model !== null && other !== null && other !== provider)
    return modelProviderMismatch(model, provider, other);
  if (effort !== null && !effortsOf(provider, model).includes(effort)) {
    return effortUnsupported(provider, model, effort);
  }
  return undefined;
}

/** What a profile runs after a change: the change's model and effort where it gives them, else the profile's. */
export function runsAfter(profile: ProfileRuns, set: Partial<ProfileRuns>): ProfileRuns {
  return {
    model: set.model === undefined ? profile.model : set.model,
    effort: set.effort === undefined ? profile.effort : set.effort,
  };
}

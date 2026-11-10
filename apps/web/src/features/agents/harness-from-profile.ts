import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import { CODEX_MODELS, MODELS } from '../../components/org/agent-labels.ts';
import type { AgentDraft } from './agent-draft.ts';

/**
 * The harness a profile's provider runs today: each provider's own (Claude Code for Claude, Codex for OpenAI). The
 * agent form no longer asks for a harness; the profile decides it. Pure.
 */
export const PROVIDER_HARNESS: Readonly<Record<ProfileProvider, Harness>> = {
  claude: 'claude_code',
  openai: 'codex',
};

/** The models a harness offers in the form. */
export const modelsOf = (harness: Harness) => (harness === 'codex' ? CODEX_MODELS : MODELS);

/**
 * Puts the draft on the harness of a picked profile's provider; a known model of the other harness gives way to the
 * new harness's first one (a typed-in model stays).
 */
export function followProvider(draft: AgentDraft, provider: ProfileProvider): void {
  const harness = PROVIDER_HARNESS[provider];
  const { values, set } = draft;
  if (values.harness === harness) return;
  set('harness', harness);
  const known = modelsOf(harness).some((option) => option.value === values.model);
  if (!values.customModel && !known) set('model', modelsOf(harness)[0]?.value ?? '');
}

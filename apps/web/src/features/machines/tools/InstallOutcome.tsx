import type { ToolsLatest } from '../../../api/types.ts';
import { Notice } from '../../../components/ui/Notice.tsx';
import { TOOL_LABELS, toolState } from './tools-text.ts';
import type { InstallState } from './use-tools.ts';

/** The runner's or the server's words without their code (`npm_missing: there is no npm…` reads `there is no npm…`). */
const wordsOf = (error: string | null) => (error ?? 'no reason given').replace(/^[a-z_]+: /, '');

/**
 * How an install ended, under its output: installed; installed but an older copy still comes first on the runner's
 * PATH (npm put the new one in ~/.local/bin); not installed, in the runner's words; or refused before it started.
 */
export function InstallOutcome({
  state,
  latest,
  onDismiss,
}: {
  readonly state: InstallState;
  readonly latest: ToolsLatest;
  readonly onDismiss: () => void;
}) {
  if (state.kind === 'refused') {
    return (
      <Notice tone="error" onDismiss={onDismiss}>
        {state.message}
      </Notice>
    );
  }
  if (state.kind !== 'succeeded' && state.kind !== 'failed') return null;
  const name = `${TOOL_LABELS[state.tool]} ${state.version}`;
  if (state.kind === 'failed') {
    return (
      <Notice tone="error" onDismiss={onDismiss}>
        {name} was not installed: {wordsOf(state.error)}.
      </Notice>
    );
  }
  const found = state.tools ? toolState(state.tools, latest, state.tool) : undefined;
  if (found?.kind === 'old') {
    return (
      <Notice tone="warning" onDismiss={onDismiss}>
        npm installed {name} into ~/.local/bin, but the runner still finds an older one first on its PATH (
        {found.version}): remove or update that one, then Check again.
      </Notice>
    );
  }
  if (found?.kind === 'missing') {
    return (
      <Notice tone="warning" onDismiss={onDismiss}>
        npm installed {name} into ~/.local/bin, but the runner does not find it yet: Check again.
      </Notice>
    );
  }
  return (
    <Notice tone="success" onDismiss={onDismiss}>
      {name} is installed.
    </Notice>
  );
}

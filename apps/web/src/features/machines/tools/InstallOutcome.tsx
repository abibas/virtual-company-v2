import type { ReactNode } from 'react';
import type { ToolsLatest } from '../../../api/types.ts';
import { Notice } from '../../../components/ui/Notice.tsx';
import { containerTooOld, containerTooOldText, TOOL_LABELS, toolState } from './tools-text.ts';
import type { InstallState } from './use-tools.ts';

/** The runner's or the server's words without their code (`npm_missing: there is no npm…` reads `there is no npm…`). */
const wordsOf = (error: string | null) => (error ?? 'no reason given').replace(/^[a-z_]+: /, '');

/**
 * How an install ended, under its output: installed; installed but an older copy still comes first on the runner's
 * PATH (npm put the new one in ~/.local/bin); not installed, in the runner's words; or refused before it started. A
 * container whose runner is older than installs in place is never a bare error: it says to update the container once,
 * with the Update container button (`containerUpdate`) beside it.
 */
export function InstallOutcome({
  state,
  latest,
  onDismiss,
  containerUpdate,
}: {
  readonly state: InstallState;
  readonly latest: ToolsLatest;
  readonly onDismiss: () => void;
  /** On a container, its Update container button; undefined elsewhere. */
  readonly containerUpdate?: ReactNode;
}) {
  const tooOld =
    (state.kind === 'refused' && state.code === 'unsupported') ||
    (state.kind === 'failed' && containerTooOld(state.error));
  if (containerUpdate !== undefined && tooOld && 'tool' in state) {
    return (
      <Notice tone="info" action={containerUpdate} onDismiss={onDismiss}>
        {containerTooOldText(state.tool)}
      </Notice>
    );
  }
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

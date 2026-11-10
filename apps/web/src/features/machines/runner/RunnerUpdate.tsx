import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, friendlyMessage } from '../../../api/errors.ts';
import type { Machine } from '../../../api/types.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { CommandBox } from '../add/CommandBox.tsx';
import { RELOAD_AFTER_MS, UPDATED_TEXT } from './runner-text.ts';

/**
 * "Update runner" on a machine card (admins and owners), "Update container" for a container: one click asks the server
 * to update the machine's runner, a spinner while it works (a reinstall over SSH takes up to a few minutes), then what
 * it did, and the card loads again once the runner is back; a container's rebuild goes on after the answer, so the card
 * loads at once and follows the server's job. A refusal says why, with the command to run when the server names one,
 * and so does a rebuild that failed after the answer (`runner.updateFailure`).
 */

type Path = keyof typeof UPDATED_TEXT;

export type RunnerUpdateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly path: Path }
  | { readonly kind: 'failed'; readonly message: string; readonly command: string | undefined };

export interface RunnerUpdate {
  readonly state: RunnerUpdateState;
  run(): void;
  dismiss(): void;
}

/** The update's state for a card: `update` is the call, `reload` loads the card again after it. */
export function useRunnerUpdate(
  update: () => Promise<{ readonly path: Path }>,
  reload: () => void,
): RunnerUpdate {
  const [state, setState] = useState<RunnerUpdateState>({ kind: 'idle' });
  const latestReload = useRef(reload);
  latestReload.current = reload;
  useEffect(() => {
    if (state.kind !== 'done') return;
    // A rebuild runs on after the answer: the card shows its job (and reads it often) from now on.
    if (state.path === 'docker_rebuild') latestReload.current();
    const timer = setTimeout(() => {
      setState({ kind: 'idle' });
      latestReload.current();
    }, RELOAD_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const run = async () => {
    setState({ kind: 'running' });
    try {
      const { path } = await update();
      setState({ kind: 'done', path });
    } catch (error) {
      const command = error instanceof ApiError ? error.command : undefined;
      setState({ kind: 'failed', message: friendlyMessage(error), command });
    }
  };
  return { state, run: () => void run(), dismiss: () => setState({ kind: 'idle' }) };
}

/** The update button; `blocked` says why it waits (another job, or the machine's live work). */
export function UpdateRunnerButton({
  update,
  blocked,
  label = 'Update runner',
  title = "Update this machine's runner to the build the server hands out",
}: {
  readonly update: RunnerUpdate;
  readonly blocked: string | undefined;
  readonly label?: string;
  readonly title?: string;
}) {
  const { kind } = update.state;
  return (
    <Button
      size="sm"
      tone="soft"
      icon={RefreshCw}
      busy={kind === 'running'}
      disabled={kind === 'done' || blocked !== undefined}
      title={blocked ?? title}
      onClick={update.run}
    >
      {label}
    </Button>
  );
}

/** A rebuild that failed after the answer, until dismissed (the server keeps it until the next job or 30 minutes). */
function FailedInBackground({
  failure,
}: {
  readonly failure: NonNullable<Machine['runner']['updateFailure']>;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (dismissed === failure.at) return null;
  return (
    <section aria-label="Runner update" className="flex flex-col gap-3">
      <Notice tone="error" onDismiss={() => setDismissed(failure.at)}>
        {failure.message}
      </Notice>
      {failure.command && <CommandBox command={failure.command} />}
    </section>
  );
}

/** What the update did, or why it did not, with the command to run instead. */
export function RunnerUpdateNotice({
  update,
  failure,
}: {
  readonly update: RunnerUpdate;
  /** The server's word on a rebuild that failed after the answer (`runner.updateFailure`), if any. */
  readonly failure?: Machine['runner']['updateFailure'] | undefined;
}) {
  const { state } = update;
  if (state.kind === 'done') {
    return (
      <Notice tone={state.path === 'docker_rebuild' ? 'info' : 'success'}>{UPDATED_TEXT[state.path]}</Notice>
    );
  }
  if (state.kind !== 'failed') {
    return failure && state.kind === 'idle' ? <FailedInBackground failure={failure} /> : null;
  }
  return (
    <section aria-label="Runner update" className="flex flex-col gap-3">
      <Notice tone="error" onDismiss={update.dismiss}>
        {state.message}
      </Notice>
      {state.command && <CommandBox command={state.command} />}
    </section>
  );
}

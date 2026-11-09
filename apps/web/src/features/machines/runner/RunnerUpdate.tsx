import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, friendlyMessage } from '../../../api/errors.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { CommandBox } from '../add/CommandBox.tsx';
import { RELOAD_AFTER_MS, UPDATED_TEXT } from './runner-text.ts';

/**
 * "Update runner" on a machine card (admins and owners): one click asks the server to update the machine's runner, a
 * spinner while it works (a reinstall over SSH takes up to a few minutes), then what it did, and the card loads again
 * once the runner is back; a refusal says why, with the command to run when the server names one.
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

/** The button in the card's action row. */
export function UpdateRunnerButton({ update }: { readonly update: RunnerUpdate }) {
  const { kind } = update.state;
  return (
    <Button
      size="sm"
      tone="soft"
      icon={RefreshCw}
      busy={kind === 'running'}
      disabled={kind === 'done'}
      title="Update this machine's runner to the build the server hands out"
      onClick={update.run}
    >
      Update runner
    </Button>
  );
}

/** Under the action row: what the update did, or why it did not, with the command to run instead. */
export function RunnerUpdateNotice({ update }: { readonly update: RunnerUpdate }) {
  const { state } = update;
  if (state.kind === 'done') return <Notice tone="success">{UPDATED_TEXT[state.path]}</Notice>;
  if (state.kind !== 'failed') return null;
  return (
    <section aria-label="Runner update" className="flex flex-col gap-3">
      <Notice tone="error" onDismiss={update.dismiss}>
        {state.message}
      </Notice>
      {state.command && <CommandBox command={state.command} />}
    </section>
  );
}

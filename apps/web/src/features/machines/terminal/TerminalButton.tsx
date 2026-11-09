import { Terminal } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { Machine } from '../../../api/types.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Tooltip } from '../../../components/ui/Tooltip.tsx';

/** xterm.js loads only when a terminal opens. */
const TerminalSheet = lazy(() =>
  import('./TerminalSheet.tsx').then((module) => ({ default: module.TerminalSheet })),
);

/** Why the terminal cannot open now, or undefined when it can. */
function unavailable(machine: Pick<Machine, 'runner'>, online: boolean): string | undefined {
  if (!online) return 'The machine is offline';
  if (!machine.runner.terminal) return 'Update the runner to use the terminal';
  return undefined;
}

/**
 * An owner's Terminal on a machine card: enabled while the machine is online and its runner has a terminal (the list's
 * `runner.terminal`), it opens the terminal's sheet; otherwise disabled, saying why.
 */
export function TerminalButton({
  companyId,
  machine,
  online,
}: {
  readonly companyId: string;
  readonly machine: Machine;
  readonly online: boolean;
}) {
  const [open, setOpen] = useState(false);
  const why = unavailable(machine, online);
  const button = (
    <Button
      size="sm"
      icon={Terminal}
      disabled={why !== undefined}
      title={why ?? 'Open a shell on this machine here'}
      onClick={() => setOpen(true)}
    >
      Terminal
    </Button>
  );
  return (
    <>
      {why === undefined ? button : <Tooltip label={why}>{button}</Tooltip>}
      {open && (
        <Suspense fallback={null}>
          <TerminalSheet companyId={companyId} machine={machine} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

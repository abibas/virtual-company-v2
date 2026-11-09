import { Terminal } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { Machine } from '../../../api/types.ts';
import { Button } from '../../../components/ui/Button.tsx';

/** xterm.js loads only when a terminal opens. */
const TerminalSheet = lazy(() =>
  import('./TerminalSheet.tsx').then((module) => ({ default: module.TerminalSheet })),
);

/**
 * An owner's Terminal on a machine card: enabled while the machine is online, it opens the terminal's sheet. A runner
 * without a terminal is told by the ticket's refusal (`terminal_unavailable`), since the list does not carry its caps.
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
  return (
    <>
      <Button
        size="sm"
        icon={Terminal}
        disabled={!online}
        title={online ? 'Open a shell on this machine here' : 'The machine is offline'}
        onClick={() => setOpen(true)}
      >
        Terminal
      </Button>
      {open && (
        <Suspense fallback={null}>
          <TerminalSheet companyId={companyId} machine={machine} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

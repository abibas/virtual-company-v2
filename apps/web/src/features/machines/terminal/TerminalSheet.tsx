import { useMemo } from 'react';
import { useApi } from '../../../api/context.ts';
import { machineCalls } from '../../../api/machines.ts';
import type { Machine } from '../../../api/types.ts';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { TerminalPanel } from './TerminalPanel.tsx';

/**
 * "Terminal · <machine>": a shell on the machine in the page, as its runner's user. Closing the sheet closes the
 * socket, which ends the shell on the machine.
 */
export function TerminalSheet({
  companyId,
  machine,
  onClose,
}: {
  readonly companyId: string;
  readonly machine: Machine;
  readonly onClose: () => void;
}) {
  const api = useApi();
  const getTicket = useMemo(() => {
    const calls = machineCalls(api, companyId);
    return () => calls.terminalTicket(machine.id);
  }, [api, companyId, machine.id]);
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={`Terminal · ${machine.name}`}
      description={`A shell as ${machine.unixUser} on ${machine.hostname}, with that user's rights. Closing this ends it.`}
    >
      <TerminalPanel getTicket={getTicket} />
    </Sheet>
  );
}

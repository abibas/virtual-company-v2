import { Power } from 'lucide-react';
import { ApiError } from '../../../api/errors.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { costText } from '../../machines/card/machine-text.ts';

/**
 * A message refused because the agent's machine is stopped and its start on a message is off (`machine_stopped`): one
 * line and "Start Airia devbox · $0.54/h and send", which sends the message again with the machine started for it.
 * Only for those who may start it; anyone else reads the refusal.
 */

/** The machine a `machine_stopped` refusal names. */
export interface StoppedMachine {
  readonly id: string;
  readonly name: string;
  readonly hourlyCost: number | null;
  readonly canStart: boolean;
}

/** The refusal's machine when the person may start it; undefined for any other failure. */
export function startable(failure: unknown): StoppedMachine | undefined {
  if (!(failure instanceof ApiError) || failure.code !== 'machine_stopped') return undefined;
  const machine = failure.details.machine as StoppedMachine | undefined;
  return machine?.canStart ? machine : undefined;
}

export function StartAndSend({
  machine,
  busy,
  disabled,
  onStart,
}: {
  readonly machine: StoppedMachine;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onStart: () => void;
}) {
  const price = machine.hourlyCost === null ? '' : ` · ${costText(machine.hourlyCost)}`;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm font-medium text-ink">{machine.name} is stopped.</p>
      <Button size="sm" tone="primary" icon={Power} busy={busy} disabled={disabled} onClick={onStart}>
        Start {machine.name}
        {price} and send
      </Button>
    </div>
  );
}

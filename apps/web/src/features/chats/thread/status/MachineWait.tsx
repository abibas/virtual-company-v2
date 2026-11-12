import { createContext, useContext, useMemo, useState } from 'react';
import { useApi } from '../../../../api/context.ts';
import { WAKE_EVERY_MS } from '../../../../api/machine-wake.ts';
import { machineCalls, useVisibleInterval } from '../../../../api/machines.ts';
import { useMachineChoices } from '../../../../api/org.ts';
import type { ChatTurnWithEvents, MachineChoice, MachinePower } from '../../../../api/types.ts';
import { useLoad } from '../../../../api/use-load.ts';
import { Spinner } from '../../../../components/ui/Button.tsx';
import { elapsedText } from '../../../placements/wake-text.ts';
import { useNow } from './use-now.ts';
import { QueuedStatus } from './WorkingStatus.tsx';

/**
 * A turn waiting for the agent's stopped machine (docs/harness.md, "When the machine is stopped"): one line that follows
 * the machine — "Starting Airia devbox… 0:42", then "Airia devbox is up · runner connecting… 1:05", then "Sending…"
 * once its runner is back — with Cancel. The chat page and the rail's chat give it their machine through
 * `ChatMachineContext`; without one it is the plain queued pill.
 */

/** The open chat's machine, and how a turn's wait for it is cancelled (its Stop). */
export interface ChatMachine {
  readonly companyId: string;
  readonly machineId: string;
  readonly cancel: (turnId: string) => Promise<void>;
}

export const ChatMachineContext = createContext<ChatMachine | undefined>(undefined);

/** Where the machine is, in a few words: online (the message is on its way), up without its runner, or starting. */
function phaseText(machine: MachineChoice | undefined, power: MachinePower | undefined): string {
  const name = machine?.name ?? 'the machine';
  if (machine?.status === 'online') return 'Sending…';
  const up = power?.box?.status === 'running' || power?.container?.status === 'running';
  return up ? `${name} is up · runner connecting…` : `Starting ${name}…`;
}

function Waiting({ turn, at }: { readonly turn: ChatTurnWithEvents; readonly at: ChatMachine }) {
  const api = useApi();
  const calls = useMemo(() => machineCalls(api, at.companyId), [api, at.companyId]);
  const machines = useMachineChoices(at.companyId);
  const power = useLoad(`chat-wait-power:${at.companyId}:${at.machineId}`, () => calls.power(at.machineId));
  useVisibleInterval(() => {
    machines.reload();
    power.reload();
  }, WAKE_EVERY_MS);
  const now = useNow(true);
  const [cancelling, setCancelling] = useState(false);
  const machine = machines.data?.find((one) => one.id === at.machineId);
  const since = Date.parse(turn.machineWaitAt ?? turn.createdAt);
  const cancel = () => {
    setCancelling(true);
    void at.cancel(turn.id).finally(() => setCancelling(false));
  };
  return (
    <div className="inline-flex h-7 w-fit max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 text-xs text-ink-2 ring-1 ring-line ring-inset">
      <Spinner size={12} className="shrink-0 text-dim" />
      <span className="truncate" role="status">
        {phaseText(machine, power.data)}
      </span>
      <span className="text-dim tabular">{elapsedText(now - since)}</span>
      <button
        type="button"
        onClick={cancel}
        disabled={cancelling}
        className="cursor-pointer font-semibold text-dim hover:text-ink hover:underline disabled:cursor-default disabled:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}

/** The line of a turn waiting for its machine, or the plain queued pill when the chat gives no machine. */
export function MachineWaitStatus({ turn }: { readonly turn: ChatTurnWithEvents }) {
  const at = useContext(ChatMachineContext);
  return at === undefined ? <QueuedStatus /> : <Waiting turn={turn} at={at} />;
}

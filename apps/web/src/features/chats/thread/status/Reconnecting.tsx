import { useContext } from 'react';
import { useMachineChoices } from '../../../../api/org.ts';
import { type ChatMachine, ChatMachineContext } from './chat-machine.ts';

/**
 * A running turn whose runner is away (S5.4, docs/harness.md "Surviving restarts"): "Reconnecting to Airia devbox…",
 * the open chat's machine by name when the page gives it (`ChatMachineContext`), else "the machine". The turn goes on
 * there; the server waits up to 30 minutes for the runner to come back with it.
 */

function Named({ at }: { readonly at: ChatMachine }) {
  const machines = useMachineChoices(at.companyId);
  const name = machines.data?.find((one) => one.id === at.machineId)?.name ?? 'the machine';
  return <>Reconnecting to {name}…</>;
}

export function ReconnectingWords() {
  const at = useContext(ChatMachineContext);
  return at === undefined ? <>Reconnecting to the machine…</> : <Named at={at} />;
}

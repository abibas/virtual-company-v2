import type { Harness } from '@mwc/shared/enums';
import { TriangleAlert } from 'lucide-react';
import { useMachineChoices } from '../../../api/org.ts';
import { Link } from '../../../app/router.tsx';
import { HARNESS_TOOL, machineToolsHref, TOOL_LABELS, toolState } from './tools-text.ts';

/**
 * Under the agent form's access profile: a warning when the CLI of the harness the picked profile runs is not installed
 * (or older than the version the server installs) on the machine chosen in Where it runs, from that runner's tools,
 * with a link to the machine's Tools part. Nothing while the machine or its tools are unknown.
 */
export function HarnessToolWarning({
  companyId,
  machineId,
  harness,
  machinesHref,
}: {
  readonly companyId: string;
  /** The machine chosen in Where it runs; empty for nowhere. */
  readonly machineId: string;
  readonly harness: Harness;
  readonly machinesHref: string;
}) {
  const machines = useMachineChoices(companyId);
  const machine = machines.data?.find((one) => one.id === machineId);
  const tools = machine?.runner.tools;
  if (machine === undefined || !tools) return null;
  const tool = HARNESS_TOOL[harness];
  const state = toolState(tools, machine.runner.toolsLatest, tool);
  if (state.kind === 'ok') return null;
  const name = TOOL_LABELS[tool];
  const words =
    state.kind === 'missing'
      ? `${name} isn't installed on ${machine.name}, so this agent can't run there yet.`
      : `${machine.name} has ${name} ${state.version}; ${state.latest} is available.`;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-input-soft px-3 py-2 text-xs text-ink">
      <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-input" />
      <span>
        {words}{' '}
        <Link
          to={machineToolsHref(machinesHref, machine.id)}
          className="font-semibold text-blue hover:underline"
        >
          Open Machines
        </Link>
      </span>
    </p>
  );
}

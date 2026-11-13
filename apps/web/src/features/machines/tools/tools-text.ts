import type { Harness } from '@mwc/shared/enums';
import { toolNeedsUpdate, toolVersionNumber } from '@mwc/shared/machines';
import type { InstallableTool, MachineTools, ToolsLatest } from '../../../api/types.ts';
import { formatDateTime } from '../../../components/data/format.ts';

/** A machine's tools as the card, the chat header and the agent form say them (docs/machines.md, "Tools"; pure). */

/** The CLIs in the order the card lists them, with their names. */
export const TOOL_ORDER = ['claude', 'codex', 'git', 'gh', 'docker'] as const;
export type ToolKey = (typeof TOOL_ORDER)[number];
export const TOOL_LABELS: Readonly<Record<ToolKey, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  git: 'git',
  gh: 'GitHub CLI',
  docker: 'Docker',
};

/** The CLI each harness runs. */
export const HARNESS_TOOL: Readonly<Record<Harness, InstallableTool>> = {
  claude_code: 'claude',
  codex: 'codex',
};

export const isInstallable = (tool: ToolKey): tool is InstallableTool =>
  tool === 'claude' || tool === 'codex';

/** A version as people read it: the number in what the CLI printed ("2.1.319"), else the text itself. */
export const shortVersion = (printed: string): string => toolVersionNumber(printed) ?? printed;

/** A CLI on a machine: not installed, older than the latest (npm's, else the server's pin), or fine. */
export type ToolState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'old'; readonly version: string; readonly latest: string }
  | { readonly kind: 'ok'; readonly version: string };

export function toolState(tools: MachineTools, latest: ToolsLatest, tool: ToolKey): ToolState {
  const printed = tools[tool];
  if (printed === null) return { kind: 'missing' };
  const version = shortVersion(printed);
  if (isInstallable(tool) && toolNeedsUpdate(printed, latest[tool])) {
    return { kind: 'old', version, latest: latest[tool] };
  }
  return { kind: 'ok', version };
}

/** The folded card's line: "Claude Code 2.1.319 · Codex —". */
export function toolsLine(tools: MachineTools): string {
  const part = (tool: InstallableTool) => {
    const printed = tools[tool];
    return `${TOOL_LABELS[tool]} ${printed === null ? '—' : shortVersion(printed)}`;
  };
  return `${part('claude')} · ${part('codex')}`;
}

/** A machine card's tools on the Machines page: `<machines>?machine=<id>#tools`. */
export function machineToolsHref(machinesHref: string, machineId: string): string {
  return `${machinesHref}?machine=${encodeURIComponent(machineId)}#tools`;
}

/** A machine's card on the Machines page: `<machines>?machine=<id>`. */
export function machineCardHref(machinesHref: string, machineId: string): string {
  return `${machinesHref}?machine=${encodeURIComponent(machineId)}`;
}

/** The ids the deep link scrolls to: a machine's card, and its Tools part. */
export const machineCardId = (machineId: string) => `machine-${machineId}`;
export const machineToolsId = (machineId: string) => `machine-${machineId}-tools`;

/** What Install asks before it runs. */
export function installQuestion(
  tool: InstallableTool,
  version: string,
  where: { readonly unixUser: string; readonly name: string },
  update: boolean,
): string {
  const what = update
    ? `Updates ${TOOL_LABELS[tool]} to ${version}`
    : `Installs ${TOOL_LABELS[tool]} ${version}`;
  return `${what} for ${where.unixUser} on ${where.name} with npm, into ~/.local/bin.`;
}

/** The quiet line under the list: where "latest" came from (npm, with when it was read, or the app's pins). */
export function latestSourceText(latest: ToolsLatest): string {
  return latest.source === 'npm' && latest.checkedAt !== null
    ? `Latest from npm, checked ${formatDateTime(latest.checkedAt)}`
    : "npm unreachable: compared with the app's pinned versions";
}

/** What Install or Update says first on a container whose runner is out of date: update the container, then this. */
export function containerFirstText(tool: InstallableTool, update: boolean): string {
  const then = `${update ? 'update' : 'install'} ${TOOL_LABELS[tool]}`;
  return `This container's runner is out of date: update the container first (it rebuilds with the new runner and keeps its enrollment, /work and installed CLIs), then ${then}.`;
}

/** True for an install a container's runner refused for being older than installs in a container. */
export function containerTooOld(error: string | null): boolean {
  return error !== null && /^(container_outdated|unsupported):/.test(error);
}

/** What the card says then, with Update container beside it. */
export function containerTooOldText(tool: InstallableTool): string {
  return `This container's runner is older than installs in place, so ${TOOL_LABELS[tool]} was not installed. Update the container once (it keeps its enrollment, /work and installed CLIs), then try again.`;
}

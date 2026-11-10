import { diffFields, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { type InstallableTool, TOOL_PACKAGES } from '@mwc/shared/machines';
import {
  type RunnerTools,
  TOOLS_CHECK_TIMEOUT_MS,
  TOOLS_INSTALL_TIMEOUT_MS,
  type ToolsInstall,
} from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import { machinesRepo } from '../repo.ts';
import { knownTools } from '../rules/runner.ts';
import {
  INSTALL_BUSY,
  INSTALL_NOT_FOUND,
  INSTALL_UNSUPPORTED,
  type InstallOutcome,
  installOutcome,
  TOOLS_OUTDATED,
  TOOLS_TIMED_OUT,
} from '../rules/tools.ts';
import { MACHINE_NOT_FOUND, MACHINE_OFFLINE, type Refusal } from '../rules.ts';
import type { ToolInstallView } from '../schemas/tools.ts';
import { HubError, type RunnerHub } from './runner/hub.ts';
import type { ToolInstall, ToolInstalls } from './tools/installs.ts';

/**
 * A machine's tools (docs/machines.md, "Tools"): a check through its runner (`tools.check`: it looks for its CLIs again
 * and sends `runner.caps`, so the hub's view and the machines list follow), and an install of Claude Code or Codex at
 * this server's pin (`tools.install`), started at once and carried on in the background: its output lines and its end
 * go to the registry the card reads, and its end to the audit log (who, which machine, which CLI, which result). Not in
 * a container (its image is rebuilt instead), one at a time per machine.
 */

export interface ToolsDeps {
  readonly hub: RunnerHub;
  readonly installs: ToolInstalls;
  readonly logger: Logger;
  /** How long a check may take; `TOOLS_CHECK_TIMEOUT_MS` unless a test shortens it. */
  readonly checkTimeoutMs?: number;
  /** How long an install may take; the runner's own limit and a minute more, unless a test shortens it. */
  readonly installTimeoutMs?: number;
}

/** Who acts. */
export interface ToolsCaller {
  readonly principalId: string;
  readonly requestId: string;
}

const repo = machinesRepo();

/** The machine and its connected runner with the tools, or why not. */
async function ready(deps: ToolsDeps, t: TenantDb, machineId: string) {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const runner = deps.hub.connected(machine.id);
  if (runner === undefined) return { machine, refusal: MACHINE_OFFLINE };
  return { machine, refusal: runner.caps.tools === undefined ? TOOLS_OUTDATED : undefined };
}

/** Has the machine's runner look for its CLIs again; their versions. */
export async function checkTools(
  deps: ToolsDeps,
  t: TenantDb,
  machineId: string,
): Promise<{ readonly ok: true; readonly tools: RunnerTools } | Refusal<404> | Refusal<409> | Refusal<504>> {
  const found = await ready(deps, t, machineId);
  if (!('machine' in found)) return found;
  if (found.refusal !== undefined) return found.refusal;
  try {
    const timeoutMs = deps.checkTimeoutMs ?? TOOLS_CHECK_TIMEOUT_MS;
    const reply = await deps.hub.request(machineId, { type: 'tools.check', cmdId: newId() }, { timeoutMs });
    if (reply.type === 'cmd.ack' || !reply.ok || reply.tools === undefined) return TOOLS_OUTDATED;
    return { ok: true, tools: knownTools(reply.tools) };
  } catch (error) {
    if (!(error instanceof HubError)) throw error;
    return error.code === 'timeout' ? TOOLS_TIMED_OUT : MACHINE_OFFLINE;
  }
}

/** The runner's answer to the install, or how waiting for it failed. */
async function askRunner(deps: ToolsDeps, install: ToolInstall): Promise<InstallOutcome> {
  const frame: ToolsInstall = {
    type: 'tools.install',
    cmdId: install.id,
    tool: install.tool,
    version: install.version,
  };
  const timeoutMs = deps.installTimeoutMs ?? TOOLS_INSTALL_TIMEOUT_MS + 60_000;
  const output = (line: string) => deps.installs.output(install, line);
  try {
    return installOutcome(await deps.hub.request(install.machineId, frame, { timeoutMs, output }));
  } catch (error) {
    const timedOut = error instanceof HubError && error.code === 'timeout';
    const why = timedOut
      ? 'timeout: the runner did not answer in time'
      : 'machine_offline: the runner went away';
    return { ok: false, tools: null, error: why };
  }
}

/** Carries an install to its end: the runner's answer, the audit row, then its state (so a reader sees both at once). */
async function carryOut(
  deps: ToolsDeps,
  t: TenantDb,
  caller: ToolsCaller,
  install: ToolInstall,
): Promise<void> {
  const outcome = await askRunner(deps, install);
  const result = outcome.ok ? 'succeeded' : 'failed';
  try {
    await repo.audit(t, {
      actorKind: 'user',
      actorPrincipalId: caller.principalId,
      requestId: caller.requestId,
      entityType: 'machine',
      entityId: install.machineId,
      action: 'tool_install',
      changes: diffFields(null, {
        tool: install.tool,
        toolVersion: install.version,
        result,
        error: outcome.error,
      }),
    });
  } catch (error) {
    deps.logger.error({ err: error, machineId: install.machineId }, 'tools: could not audit an install');
  }
  deps.installs.finish(install, outcome);
}

/**
 * Starts installing `tool` at this server's pin on the machine; the install goes on after the answer (`installStatus`
 * reads it), and `ended` resolves once it ended (it never rejects).
 */
export async function startInstall(
  deps: ToolsDeps,
  t: TenantDb,
  caller: ToolsCaller,
  target: { readonly machineId: string; readonly tool: InstallableTool },
): Promise<
  | { readonly ok: true; readonly install: ToolInstall; readonly ended: Promise<void> }
  | Refusal<404>
  | Refusal<409>
> {
  const found = await ready(deps, t, target.machineId);
  if (!('machine' in found)) return found;
  if (found.machine.kind === 'container') return INSTALL_UNSUPPORTED;
  if (found.refusal !== undefined) return found.refusal;
  if (deps.installs.running(found.machine.id) !== undefined) return INSTALL_BUSY;
  const { tool } = target;
  const install = deps.installs.start({
    companyId: t.companyId,
    machineId: found.machine.id,
    tool,
    version: TOOL_PACKAGES[tool].version,
    principalId: caller.principalId,
  });
  deps.logger.info({ machineId: install.machineId, tool, version: install.version }, 'tools: installing');
  return { ok: true, install, ended: carryOut(deps, t, caller, install) };
}

/** An install of the machine as the API shows it, its output from line `from` on. */
export function installStatus(
  deps: Pick<ToolsDeps, 'installs'>,
  t: TenantDb,
  machineId: string,
  installId: string,
  from = 0,
): { readonly ok: true; readonly install: ToolInstallView } | Refusal<404> {
  const install = deps.installs.get(t.companyId, machineId, installId);
  if (install === undefined) return INSTALL_NOT_FOUND;
  const { id, tool, version, status, lines, tools, error, startedAt, finishedAt } = install;
  return {
    ok: true,
    install: {
      ...{ id, tool, version, status, tools, error },
      lines: lines.slice(from),
      next: lines.length,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt?.toISOString() ?? null,
    },
  };
}

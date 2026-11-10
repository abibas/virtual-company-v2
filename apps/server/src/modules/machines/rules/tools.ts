import {
  type CmdAck,
  type RunnerTools,
  TOOL_OUTPUT_LINES_MAX,
  TOOLS_CHECK_TIMEOUT_MS,
  type ToolsResult,
} from '@mwc/shared/runner-protocol';
import { refuse } from '../rules.ts';
import { knownTools } from './runner.ts';

/**
 * A machine's tools' pure rules (docs/machines.md, "Tools"): their refusals, how an install's output is kept, and what
 * the runner's answer to an install says.
 */

export const TOOLS_OUTDATED = refuse(
  409,
  'runner_outdated',
  "The machine's runner is older than the tools: update it on the Machines page",
);

export const TOOLS_TIMED_OUT = refuse(
  504,
  'runner_timeout',
  `The machine's runner did not answer within ${TOOLS_CHECK_TIMEOUT_MS / 1000} seconds`,
);

export const INSTALL_NOT_FOUND = refuse(
  404,
  'install_not_found',
  'No such install on this machine (the server keeps them an hour, and forgets them when it restarts)',
);

/**
 * Keeps an output line: at most `TOOL_OUTPUT_LINES_MAX` lines and the runner's one notice after them (a runner sends no
 * more; this holds a misbehaving one to it too). False when it was dropped.
 */
export function keepLine(lines: string[], line: string): boolean {
  if (lines.length > TOOL_OUTPUT_LINES_MAX) return false;
  lines.push(line);
  return true;
}

/** How an install ended, as the API shows it. */
export interface InstallOutcome {
  readonly ok: boolean;
  readonly tools: RunnerTools | null;
  readonly error: string | null;
}

/**
 * What a container's runner built before installs in a container (2026-11-10) answers `tools.install` with
 * (`unsupported: …`), said as what to do: update the container once.
 */
export const CONTAINER_OUTDATED =
  "container_outdated: this container's runner is older than installs in a container; update the container once, then install again";

/** An install's end on a container: an old runner's `unsupported` becomes `CONTAINER_OUTDATED`. */
export function containerOutcome(outcome: InstallOutcome, container: boolean): InstallOutcome {
  const old = container && !outcome.ok && outcome.error?.startsWith('unsupported:') === true;
  return old ? { ...outcome, error: CONTAINER_OUTDATED } : outcome;
}

/** The runner's answer to `tools.install`: its result, or a runner that did not know the frame. */
export function installOutcome(reply: ToolsResult | CmdAck): InstallOutcome {
  if (reply.type === 'cmd.ack') {
    return { ok: false, tools: null, error: 'runner_outdated: the runner does not know installs; update it' };
  }
  const tools = reply.tools === undefined ? null : knownTools(reply.tools);
  return { ok: reply.ok, tools, error: reply.ok ? null : (reply.error ?? 'failed: no reason given') };
}

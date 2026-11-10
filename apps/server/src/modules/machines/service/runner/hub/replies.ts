import type {
  CmdAck,
  FsResult,
  PowerResult,
  RunnerFrame,
  RunnerUpdateResult,
  ToolsResult,
} from '@mwc/shared/runner-protocol';

/**
 * How a runner answers the hub's commands (docs/runner-protocol.md, "Semantics"): `cmd.ack`, `power.result` for
 * `power.command`, `runner.update.result` for `runner.update`, `fs.result` for `fs.list` and `fs.mkdir` and
 * `tools.result` for `tools.check` and `tools.install`, matched by `cmdId`; and why a request failed.
 */

/** A runner's answer to a command. */
export type CommandReply = CmdAck | PowerResult | RunnerUpdateResult | FsResult | ToolsResult;

const REPLIES: ReadonlySet<string> = new Set([
  'cmd.ack',
  'power.result',
  'runner.update.result',
  'fs.result',
  'tools.result',
]);

/** True for a frame that answers a command. */
export const isReply = (frame: RunnerFrame): frame is CommandReply => REPLIES.has(frame.type);

/** Why a request to a runner failed: no ready connection, no answer in time, or the socket closed first. */
export type HubErrorCode = 'offline' | 'timeout' | 'disconnected';

export class HubError extends Error {
  readonly code: HubErrorCode;
  readonly machineId: string;

  constructor(code: HubErrorCode, machineId: string, message: string) {
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.machineId = machineId;
  }
}

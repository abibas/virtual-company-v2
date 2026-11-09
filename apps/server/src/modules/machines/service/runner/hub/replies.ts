import type { CmdAck, PowerResult, RunnerFrame, RunnerUpdateResult } from '@mwc/shared/runner-protocol';

/**
 * How a runner answers the hub's commands (docs/runner-protocol.md, "Semantics"): `cmd.ack`, `power.result` for
 * `power.command` and `runner.update.result` for `runner.update`, matched by `cmdId`; and why a request failed.
 */

/** A runner's answer to a command. */
export type CommandReply = CmdAck | PowerResult | RunnerUpdateResult;

const REPLIES: ReadonlySet<string> = new Set(['cmd.ack', 'power.result', 'runner.update.result']);

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

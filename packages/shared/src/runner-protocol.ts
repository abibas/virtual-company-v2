import { encodeFrameText, type FrameParse, frameTable, parseFrame } from './runner-protocol/frame.ts';
import { RUNNER_FRAMES, type RunnerFrame } from './runner-protocol/runner-frames.ts';
import { SERVER_FRAMES, type ServerFrame } from './runner-protocol/server-frames.ts';

/**
 * The runner protocol v1 (docs/runner-protocol.md): one WebSocket from each runner to the server, JSON frames told
 * apart by `type`, fields in camelCase. The server's hub and the runner both import this module, so its types are the
 * contract. The parts live in `runner-protocol/`; this entry reads and writes frames.
 */

export {
  ClaudeVersion,
  compareRunnerVersions,
  RUNNER_VERSION_PATTERN,
  RunnerVersion,
} from './runner-protocol/common.ts';
export {
  DEVBOX_KEEPALIVE_DURATION,
  DEVBOX_KEEPALIVE_REFRESH_MS,
  EVENT_BATCH_MAX_BYTES,
  EVENT_BATCH_MAX_EVENTS,
  JOB_OFFER_TTL_MS,
  KEY_ROTATION_OVERLAP_MS,
  MACHINE_SAMPLE_MS,
  RUN_LEASE_MS,
  RUNNER_CLOSE,
  RUNNER_FRAME_MAX_BYTES,
  RUNNER_HEARTBEAT_MS,
  RUNNER_HELLO_TIMEOUT_MS,
  RUNNER_PING_MS,
  RUNNER_PROTOCOL_VERSION,
  RUNNER_SUBPROTOCOL,
  RUNNER_WS_PATH,
  UNACKED_EVENTS_MAX,
} from './runner-protocol/constants.ts';
export {
  ENROLLMENT_TOKEN_PATTERN,
  ENROLLMENT_TOKEN_TTL_MS,
  EnrollmentToken,
  RUNNER_BUNDLE_PATH,
  RUNNER_ENROLL_PATH,
  RUNNER_INSTALL_SCRIPT_PATH,
  RUNNER_SHA256_HEADER,
  RunnerEnrollRequest,
  RunnerEnrollResponse,
} from './runner-protocol/enroll.ts';
export { FrameError, type FrameErrorCode, type FrameParse, utf8Bytes } from './runner-protocol/frame.ts';
export {
  EnvName,
  MachinePath,
  PermissionPolicy,
  RUN_SECRETS_MAX,
  RunInputText,
  RunLimits,
  RunPlacement,
  RunSecrets,
  RunSession,
  RunSpec,
} from './runner-protocol/run-spec.ts';
export {
  ATTENTION_OPTIONS_MAX,
  AttentionCreate,
  AttentionKind,
  AttentionOption,
  AttentionWait,
  CmdAck,
  HoldSource,
  HoldState,
  JobAccept,
  JobDecline,
  PowerResult,
  RESYNC_RUNS_MAX,
  ResyncRun,
  RUNNER_FRAMES,
  RUNNER_SLOTS_MAX,
  RunEvent,
  RunEvents,
  RunnerCaps,
  RunnerFrame,
  type RunnerFrameType,
  RunnerHeartbeat,
  RunnerHello,
  RunnerResync,
  RunState,
} from './runner-protocol/runner-frames.ts';
export {
  AttentionAnswer,
  AttentionResolved,
  JobOffer,
  KeyRotate,
  MachineHold,
  PermissionDecision,
  PowerArgs,
  PowerCommand,
  PowerTarget,
  RunAck,
  RunInput,
  RunnerDrain,
  RunnerKey,
  RunStart,
  RunStop,
  SERVER_FRAMES,
  ServerFrame,
  type ServerFrameType,
  ServerHello,
  StopMode,
} from './runner-protocol/server-frames.ts';

const RUNNER_TABLE = frameTable<RunnerFrame>(RUNNER_FRAMES);
const SERVER_TABLE = frameTable<ServerFrame>(SERVER_FRAMES);

/** Reads a frame a runner sent (the server's side). */
export function parseRunnerFrame(text: string): FrameParse<RunnerFrame> {
  return parseFrame(text, RUNNER_TABLE);
}

/** Reads a frame the server sent (the runner's side). */
export function parseServerFrame(text: string): FrameParse<ServerFrame> {
  return parseFrame(text, SERVER_TABLE);
}

/** The text to send for a frame of either direction; throws a `too_large` FrameError over the frame's limit. */
export function encodeFrame(frame: RunnerFrame | ServerFrame): string {
  return encodeFrameText(frame);
}

import { z } from 'zod';
import { apiKeyKind } from '../api-keys.ts';
import { EpochMs } from '../identity.ts';
import { AiriaDevboxRef, PowerAction, TimeZone } from '../machines.ts';
import { frame, protocolObject, RunnerVersion, Uuid } from './common.ts';
import { FOLDER_SERVER_FRAMES } from './folders.ts';
import { RunSpec } from './run-spec.ts';
import { ATTENTION_OPTIONS_MAX } from './runner-frames.ts';
import { TERMINAL_SERVER_FRAMES } from './terminal.ts';
import { TOOL_SERVER_FRAMES } from './tools.ts';
import { TURN_SERVER_FRAMES } from './turns.ts';
import { RunnerUpdate } from './update.ts';

/**
 * The frames the server sends to a runner (docs/runner-protocol.md, "Server to runner"). Every one with a `cmdId` is
 * a command: the runner answers it once with `cmd.ack` (`power.command` with `power.result`, `runner.update` with
 * `runner.update.result`, `fs.list`, `fs.mkdir` and `fs.mkdirp` with `fs.result`, `tools.check` and `tools.install` with
 * `tools.result`), and acks a repeat of a `cmdId` it already ran without running it again.
 */

/** The answer to `runner.hello`: the server's protocol, the lowest runner version it takes, the runner's machine. */
export const ServerHello = frame('server.hello', {
  protocol: z.int().min(1),
  minRunnerVersion: RunnerVersion,
  machineId: Uuid,
  /**
   * True from a server that takes the turns a runner holds (S5.4): it answers a hello naming turns with `turn.resume`.
   * Left out by an older server, which failed those turns already; the runner then stops them.
   */
  resume: z.boolean().optional(),
});
export type ServerHello = z.infer<typeof ServerHello>;

/** A run for this runner, if it takes it by `expiresAt` (`job.accept`); then `run.start` follows. */
export const JobOffer = frame('job.offer', {
  id: Uuid,
  runId: Uuid,
  agentId: Uuid,
  expiresAt: EpochMs,
});
export type JobOffer = z.infer<typeof JobOffer>;

/** Start an accepted run. */
export const RunStart = frame('run.start', {
  cmdId: Uuid,
  spec: RunSpec,
});
export type RunStart = z.infer<typeof RunStart>;

/** A message for a live run, delivered mid-turn or as its next turn. */
export const RunInput = frame('run.input', {
  cmdId: Uuid,
  runId: Uuid,
  inputId: Uuid,
  text: z.string().min(1),
});
export type RunInput = z.infer<typeof RunInput>;

/** A permission's answer: allow, deny, or deny and stop the turn. */
export const PermissionDecision = z.enum(['allow', 'deny', 'deny_stop']);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

/** A person's answer: the options they chose, their own words, or a permission decision (at least one). */
export const AttentionAnswer = protocolObject({
  optionIds: z.array(z.string().min(1).max(64)).min(1).max(ATTENTION_OPTIONS_MAX).optional(),
  text: z.string().min(1).optional(),
  decision: PermissionDecision.optional(),
}).refine(
  (answer) => answer.optionIds !== undefined || answer.text !== undefined || answer.decision !== undefined,
  'an answer has options, text or a decision',
);
export type AttentionAnswer = z.infer<typeof AttentionAnswer>;

/** An attention item of the run was answered (`by` is the principal who answered). */
export const AttentionResolved = frame('attention.resolved', {
  cmdId: Uuid,
  runId: Uuid,
  attentionId: Uuid,
  answer: AttentionAnswer,
  by: Uuid,
});
export type AttentionResolved = z.infer<typeof AttentionResolved>;

/** `graceful` walks the stop ladder (SIGINT, SIGTERM, SIGKILL); `kill` goes straight to SIGKILL. */
export const StopMode = z.enum(['graceful', 'kill']);
export type StopMode = z.infer<typeof StopMode>;

export const RunStop = frame('run.stop', {
  cmdId: Uuid,
  runId: Uuid,
  mode: StopMode,
});
export type RunStop = z.infer<typeof RunStop>;

/** The highest contiguous `seq` of the run the server has stored: the runner may forget events up to it. */
export const RunAck = frame('run.ack', {
  runId: Uuid,
  ackedSeq: z.int().nonnegative(),
});
export type RunAck = z.infer<typeof RunAck>;

/** A runner key (`mwc_rk_` and 32 base62 characters). */
export const RunnerKey = z.string().refine((key) => apiKeyKind(key) === 'runner', 'a runner key (mwc_rk_…)');

/** The runner's new key: it saves it (0600) before the ack; the old one keeps working `KEY_ROTATION_OVERLAP_MS`. */
export const KeyRotate = frame('key.rotate', {
  cmdId: Uuid,
  runnerKey: RunnerKey,
});
export type KeyRotate = z.infer<typeof KeyRotate>;

/** Take no new runs until the runner restarts (offers are declined, live runs go on). */
export const RunnerDrain = frame('runner.drain', {
  cmdId: Uuid,
});
export type RunnerDrain = z.infer<typeof RunnerDrain>;

/** Keep the machine awake until `until` (milliseconds), or release the server's hold with null. */
export const MachineHold = frame('machine.hold', {
  cmdId: Uuid,
  until: EpochMs.nullable(),
});
export type MachineHold = z.infer<typeof MachineHold>;

/** The machine a power command is for, by its provider. */
export const PowerTarget = z.discriminatedUnion('provider', [
  protocolObject({ provider: z.literal('airia_devbox'), ref: AiriaDevboxRef }),
]);
export type PowerTarget = z.infer<typeof PowerTarget>;

export const PowerArgs = protocolObject({
  /** The IANA zone `set_timezone` gives the machine (the devbox's `devbox-tz`). */
  timezone: TimeZone.optional(),
});
export type PowerArgs = z.infer<typeof PowerArgs>;

/** To a power controller (a runner whose `caps.power` has the target's provider): act on another machine. */
export const PowerCommand = frame('power.command', {
  cmdId: Uuid,
  target: PowerTarget,
  action: PowerAction,
  args: PowerArgs.optional(),
}).refine((command) => command.action !== 'set_timezone' || command.args?.timezone !== undefined, {
  message: 'set_timezone needs args.timezone',
  path: ['args', 'timezone'],
});
export type PowerCommand = z.infer<typeof PowerCommand>;

/** The most tunnels one `tunnel.set` holds (one per devbox the controller powers). */
export const TUNNELS_MAX = 64;

/** A TCP port, 1–65535. */
const Port = z.int().min(1).max(65535);

/**
 * One reverse SSH tunnel a power controller holds for a machine it powers: the machine's `127.0.0.1:remotePort` leads
 * to the controller's `127.0.0.1:localPort` (the server's own port), so the machine's runner reaches the server with
 * no public address. `running` (2026-11-12) is true while the machine's last power reading says it runs: the holder
 * then retries within 30 s and clears the machine's port before each retry that follows a forward failure; left out
 * (by an older server too) it is false. A change of it alone never restarts a tunnel.
 */
export const TunnelSpec = protocolObject({
  machineId: Uuid,
  target: PowerTarget,
  remotePort: Port,
  localPort: Port,
  running: z.boolean().optional(),
});
export type TunnelSpec = z.infer<typeof TunnelSpec>;

/**
 * To a power controller: every tunnel it should hold now, the full set (an empty one stops them all). The runner
 * reconciles it: it starts the missing ones, stops the extra ones and restarts one whose target or ports changed.
 */
export const TunnelSet = frame('tunnel.set', {
  tunnels: z.array(TunnelSpec).max(TUNNELS_MAX),
}).refine((set) => new Set(set.tunnels.map((tunnel) => tunnel.machineId)).size === set.tunnels.length, {
  message: 'one tunnel per machine',
  path: ['tunnels'],
});
export type TunnelSet = z.infer<typeof TunnelSet>;

/** Every server frame, in the order of the reference. */
export const SERVER_FRAMES = [
  ServerHello,
  JobOffer,
  RunStart,
  RunInput,
  AttentionResolved,
  RunStop,
  RunAck,
  KeyRotate,
  RunnerDrain,
  MachineHold,
  PowerCommand,
  TunnelSet,
  ...TERMINAL_SERVER_FRAMES,
  RunnerUpdate,
  ...TURN_SERVER_FRAMES,
  ...FOLDER_SERVER_FRAMES,
  ...TOOL_SERVER_FRAMES,
] as const;

/** Any frame the server sends, told apart by `type`. */
export const ServerFrame = z.discriminatedUnion('type', SERVER_FRAMES);
export type ServerFrame = z.infer<typeof ServerFrame>;
export type ServerFrameType = ServerFrame['type'];

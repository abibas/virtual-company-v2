import { z } from 'zod';
import { Harness, HoldSource } from '../enums.ts';
import { EpochMs } from '../identity.ts';
import { HoldDriver, MachineSample, PowerProvider, PowerStatus } from '../machines.ts';
import {
  ClaudeVersion,
  ErrorText,
  frame,
  JsonObject,
  protocolObject,
  RunnerVersion,
  Uuid,
} from './common.ts';
import { EVENT_BATCH_MAX_EVENTS } from './constants.ts';
import { TERMINAL_RUNNER_FRAMES } from './terminal.ts';
import { RunnerBuild, RunnerUpdateResult } from './update.ts';

/** The frames a runner sends to the server (docs/runner-protocol.md, "Runner to server"). */

/** The most runs a runner takes at once (`caps.slots`), and so the most live runs a heartbeat lists. */
export const RUNNER_SLOTS_MAX = 64;

/** The most runs one `runner.resync` reports: live ones and finished ones whose events are not all acked. */
export const RESYNC_RUNS_MAX = 1000;

/** The most options an attention item offers (up to 4 questions of up to 8 options each). */
export const ATTENTION_OPTIONS_MAX = 32;

/**
 * What a runner can do: the harnesses it has, its slots, how it holds its machine, the providers it can power, whether
 * it opens terminals, and whether it updates itself.
 */
export const RunnerCaps = protocolObject({
  harnesses: z.array(Harness).max(Harness.options.length),
  slots: z.int().min(0).max(RUNNER_SLOTS_MAX),
  hold: HoldDriver,
  /** Present when `airia` and `gcloud` are installed and signed in on this machine: it is a power controller. */
  power: z.array(PowerProvider).max(PowerProvider.options.length),
  /** True when its PTY loaded (`terminal.open` works); false from a runner older than the terminal. */
  terminal: z.boolean().default(false),
  /**
   * True for an installed copy its service manager restarts (launchd or systemd): it carries out `runner.update`. False
   * in a container, from the sources, and from a runner older than the self-update.
   */
  selfUpdate: z.boolean().default(false),
});
export type RunnerCaps = z.infer<typeof RunnerCaps>;

/** The first frame on every connection. */
export const RunnerHello = frame('runner.hello', {
  protocol: z.int().min(1),
  version: RunnerVersion,
  caps: RunnerCaps,
  /**
   * `claude --version` on the machine now, null without Claude Code (S4.2); a runner that leaves it out keeps the
   * version the machine has on record.
   */
  claudeVersion: ClaudeVersion.nullable().optional(),
  /**
   * The build it runs: the SHA-256 of the `runner.mjs` it was started from, null from the sources; left out by a runner
   * older than it (the server then cannot tell whether it is current).
   */
  build: RunnerBuild.nullable().optional(),
});
export type RunnerHello = z.infer<typeof RunnerHello>;

/** Every `RUNNER_HEARTBEAT_MS`: renews the lease of every run it lists; a sample rides along once a minute. */
export const RunnerHeartbeat = frame('runner.heartbeat', {
  /** Monotonic milliseconds since the runner started; it stops while the machine sleeps (wall time less it = sleep). */
  awakeMs: z.int().nonnegative(),
  load1: z.number().nonnegative(),
  /** The runs live on the machine now. */
  liveRuns: z.array(Uuid).max(RUNNER_SLOTS_MAX),
  /** Events journaled and not yet acked by the server. */
  backlog: z.int().nonnegative(),
  /** The runner's wall clock, in milliseconds. */
  now: EpochMs,
  sample: MachineSample.optional(),
});
export type RunnerHeartbeat = z.infer<typeof RunnerHeartbeat>;

/** A run as the runner finds it on its disk: its process alive, exited (its `exit` file), or gone without one. */
export const RunState = z.enum(['running', 'exited', 'gone']);
export type RunState = z.infer<typeof RunState>;

export const ResyncRun = protocolObject({
  runId: Uuid,
  state: RunState,
  /** The process's exit code once `exited`; null otherwise. */
  exitCode: z.int().nullable(),
  /** The highest `seq` journaled for the run; 0 before its first event. */
  lastSeq: z.int().nonnegative(),
});
export type ResyncRun = z.infer<typeof ResyncRun>;

/** Right after `server.hello` on every connection: what the runner has, so the server reconciles its runs. */
export const RunnerResync = frame('runner.resync', {
  runs: z.array(ResyncRun).max(RESYNC_RUNS_MAX),
});
export type RunnerResync = z.infer<typeof RunnerResync>;

/** The runner takes an offered run (`id` is the offer's). */
export const JobAccept = frame('job.accept', {
  id: Uuid,
  runId: Uuid,
});
export type JobAccept = z.infer<typeof JobAccept>;

/** The runner refuses an offered run (no free slot, draining, a harness it lacks). */
export const JobDecline = frame('job.decline', {
  id: Uuid,
  runId: Uuid,
  reason: z.string().min(1).max(500),
});
export type JobDecline = z.infer<typeof JobDecline>;

/** One normalized harness event; `(runId, seq)` is assigned when it is journaled, so a resend is a duplicate. */
export const RunEvent = protocolObject({
  runId: Uuid,
  seq: z.int().min(1),
  at: EpochMs,
  /** The event's kind (`status`, `text`, `tool_use`, `result`, …; the harness driver's list). */
  kind: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/, 'a lower-case event kind'),
  data: JsonObject,
});
export type RunEvent = z.infer<typeof RunEvent>;

/** A batch of journaled events: 1 to 100, and at most `EVENT_BATCH_MAX_BYTES` as a frame. */
export const RunEvents = frame('run.events', {
  events: z.array(RunEvent).min(1).max(EVENT_BATCH_MAX_EVENTS),
});
export type RunEvents = z.infer<typeof RunEvents>;

/** The inbox kinds a run raises (docs/architecture.md, section 11); `done` is the server's own. */
export const AttentionKind = z.enum(['permission', 'question', 'blocked', 'review', 'failed']);
export type AttentionKind = z.infer<typeof AttentionKind>;

/** Whether the run waits live for the answer, or ends its turn and gets it as its next message. */
export const AttentionWait = z.enum(['live', 'next_turn']);
export type AttentionWait = z.infer<typeof AttentionWait>;

export const AttentionOption = protocolObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});
export type AttentionOption = z.infer<typeof AttentionOption>;

/** A run needs a person. `id` is the runner's own, so a resend after a reconnect is the same item. */
export const AttentionCreate = frame('attention.create', {
  id: Uuid,
  runId: Uuid,
  kind: AttentionKind,
  wait: AttentionWait,
  prompt: z.string().min(1),
  options: z.array(AttentionOption).max(ATTENTION_OPTIONS_MAX),
});
export type AttentionCreate = z.infer<typeof AttentionCreate>;

/** The answer to every server frame that has a `cmdId`, except `power.command` (answered by `power.result`). */
export const CmdAck = frame('cmd.ack', {
  cmdId: Uuid,
  ok: z.boolean(),
  /** Why it failed, when `ok` is false. */
  error: ErrorText.optional(),
});
export type CmdAck = z.infer<typeof CmdAck>;

/** What set the runner's hold: the server's `machine.hold`, or the runner itself while runs are live (an enum of the db). */
export { HoldSource };

/**
 * The hold the runner applies, sent on every change and after each `runner.resync`: `until` is the end its driver
 * guarantees (milliseconds), null when the machine is not held; `source` is what set this state.
 */
export const HoldState = frame('hold.state', {
  until: EpochMs.nullable(),
  source: HoldSource,
});
export type HoldState = z.infer<typeof HoldState>;

/** A power controller's answer to `power.command`, with the provider's status and metadata when it has them. */
export const PowerResult = frame('power.result', {
  cmdId: Uuid,
  ok: z.boolean(),
  status: PowerStatus.optional(),
  /** The provider's facts about the machine (for the devbox: its zone, size, `devbox-tz`, …). */
  metadata: JsonObject.optional(),
  error: ErrorText.optional(),
});
export type PowerResult = z.infer<typeof PowerResult>;

/** A tunnel as its controller sees it: its process just started, alive for a while, or ended (and retried later). */
export const TunnelStatus = z.enum(['connecting', 'up', 'down']);
export type TunnelStatus = z.infer<typeof TunnelStatus>;

/** The longest `tunnel.state` error: the last line the tunnel's process printed, cut. */
export const TUNNEL_ERROR_MAX = 500;

/**
 * A power controller's tunnel for a machine changed (`tunnel.set`), and each tunnel's state again after every
 * `server.hello`: `connecting` when its process starts, `up` once it has stayed alive a while, `down` when it ended,
 * with why (the last line it printed) as `error`; a `connecting` after a `down` keeps that error.
 */
export const TunnelState = frame('tunnel.state', {
  machineId: Uuid,
  state: TunnelStatus,
  error: z.string().min(1).max(TUNNEL_ERROR_MAX).optional(),
});
export type TunnelState = z.infer<typeof TunnelState>;

/** Every runner frame, in the order of the reference. */
export const RUNNER_FRAMES = [
  RunnerHello,
  RunnerHeartbeat,
  RunnerResync,
  JobAccept,
  JobDecline,
  RunEvents,
  AttentionCreate,
  CmdAck,
  HoldState,
  PowerResult,
  TunnelState,
  ...TERMINAL_RUNNER_FRAMES,
  RunnerUpdateResult,
] as const;

/** Any frame a runner sends, told apart by `type`. */
export const RunnerFrame = z.discriminatedUnion('type', RUNNER_FRAMES);
export type RunnerFrame = z.infer<typeof RunnerFrame>;
export type RunnerFrameType = RunnerFrame['type'];

import { compareRunnerVersions, RUN_LEASE_MS } from '@mwc/shared/runner-protocol';

/**
 * The machines module's pure rules (S4.2): its refusals, when a runner is too old, when a machine's lease has lapsed,
 * which minute a sample is kept under, how an enrollment token is refused. The stats math is `rules/stats.ts`.
 */

/** The statuses a refusal of this module has. */
export type RefusalStatus = 401 | 404 | 409 | 422 | 502 | 504;

/** A refusal the routes answer in the common error shape; `S` narrows its status to what a route declares. */
export interface Refusal<S extends RefusalStatus = 401 | 404> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

export const refuse = <S extends RefusalStatus>(status: S, code: string, message: string): Refusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

export const MACHINE_NOT_FOUND = refuse(404, 'machine_not_found', 'No such machine in this company');
export const NOT_A_VM = refuse(422, 'not_a_vm', 'Only an Airia devbox is powered on and off from here');
export const CONTROLLER_NOT_FOUND = refuse(
  422,
  'controller_not_found',
  'No such machine in this company to power this one',
);
export const CONTROLLER_IS_SELF = refuse(422, 'controller_is_self', 'A machine cannot power itself');
export const NO_CONTROLLER = refuse(
  409,
  'no_controller',
  'No connected machine can power this box: run the runner where the airia CLI and gcloud are signed in, or choose its controller',
);
export const SEVERAL_CONTROLLERS = refuse(
  409,
  'no_controller',
  'Several connected machines can power this box: choose its controller',
);
export const CONTROLLER_OFFLINE = refuse(
  409,
  'controller_offline',
  'The machine that powers this box is not connected',
);
export const MACHINE_OFFLINE = refuse(409, 'machine_offline', "The machine's runner is not connected");
export const TERMINAL_UNAVAILABLE = refuse(
  409,
  'terminal_unavailable',
  "The machine's runner has no terminal: its PTY did not load (its log says why), or it is older than the terminal",
);
export const TOKEN_UNKNOWN = refuse(401, 'unauthenticated', 'The enrollment token is not valid');
export const TOKEN_USED = refuse(401, 'unauthenticated', 'The enrollment token was used already');
export const TOKEN_EXPIRED = refuse(401, 'unauthenticated', 'The enrollment token has expired');

/** The lowest runner version the server takes (`server.hello.minRunnerVersion`); raised when the protocol needs it. */
export const MIN_RUNNER_VERSION = '0.0.0';

/** True when a runner of `version` is below `min` and is closed with 4003 right after its hello. */
export function isTooOld(version: string, min: string): boolean {
  return compareRunnerVersions(version, min) < 0;
}

/** A machine whose runner sent nothing for this long is offline: the run lease (90 s), as its runs would be lost. */
export const MACHINE_LEASE_MS = RUN_LEASE_MS;

/** Samples are kept 7 days, and pruned once an hour. */
export const SAMPLE_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const PRUNE_INTERVAL_MS = 60 * 60_000;

const MINUTE_MS = 60_000;

/**
 * The minute a sample is kept under: its own time truncated to the minute, never later than the server's now (a
 * runner's clock running ahead would keep its samples looking fresh).
 */
export function sampleMinute(sampleAt: number, now: Date): Date {
  const at = Math.min(sampleAt, now.getTime());
  return new Date(at - (((at % MINUTE_MS) + MINUTE_MS) % MINUTE_MS));
}

/**
 * When a session that ended without its close (the server crashed, the connection was replaced or swept) is taken to
 * have ended: the machine's last sign of life, never before the session began.
 */
export function endOfLostSession(connectedAt: Date, lastSeenAt: Date | null): Date {
  return lastSeenAt !== null && lastSeenAt > connectedAt ? lastSeenAt : connectedAt;
}

/** Why an enrollment token cannot be used at `now`, or undefined when it can: once only, before it expires. */
export function tokenRefusal(
  token: { readonly usedAt: Date | null; readonly expiresAt: Date },
  now: Date,
): Refusal | undefined {
  if (token.usedAt !== null) return TOKEN_USED;
  if (token.expiresAt <= now) return TOKEN_EXPIRED;
  return undefined;
}

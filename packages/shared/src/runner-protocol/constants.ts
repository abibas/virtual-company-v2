/**
 * The runner protocol's numbers (docs/runner-protocol.md, "Limits and timers"). Durations are milliseconds, sizes are
 * bytes of the UTF-8 JSON text of one frame.
 */

/** The protocol version a runner names in `runner.hello` and the server in `server.hello`. */
export const RUNNER_PROTOCOL_VERSION = 1;

/** The WebSocket subprotocol (`Sec-WebSocket-Protocol`) both sides speak. */
export const RUNNER_SUBPROTOCOL = 'mwc-runner.v1';

/** Where a runner opens its one WebSocket. */
export const RUNNER_WS_PATH = '/api/runner/ws';

/** The largest frame either side sends or accepts (the server's `ws` `maxPayload`). */
export const RUNNER_FRAME_MAX_BYTES = 256 * 1024;

/** The most events one `run.events` frame carries. */
export const EVENT_BATCH_MAX_EVENTS = 100;

/** The largest `run.events` frame; a runner cuts an event down to fit one alone. */
export const EVENT_BATCH_MAX_BYTES = 64 * 1024;

/** How often the server pings each socket (a WebSocket ping; the runner's library answers with a pong). */
export const RUNNER_PING_MS = 20_000;

/** How often a runner sends `runner.heartbeat`; each one renews the lease of the runs it lists. */
export const RUNNER_HEARTBEAT_MS = 20_000;

/** A run's lease after a heartbeat names it: `runs.lease_expires_at = now + 90 s`; a lapse makes it `lost`. */
export const RUN_LEASE_MS = 90_000;

/** How long a `job.offer` waits for `job.accept` before the server offers the run again. */
export const JOB_OFFER_TTL_MS = 30_000;

/** The most events a runner has sent and the server not yet acked (`run.ack`), over all its runs. */
export const UNACKED_EVENTS_MAX = 500;

/** How often a runner takes a `MachineSample`; it rides on the next heartbeat. */
export const MACHINE_SAMPLE_MS = 60_000;

/** How often a held devbox's keepalive is refreshed. */
export const DEVBOX_KEEPALIVE_REFRESH_MS = 5 * 60_000;

/** The duration written with `devbox-keepalive` at each refresh, always in this form (`'20m'` wrote nothing in v1). */
export const DEVBOX_KEEPALIVE_DURATION = '20 minutes';

/** How long the server waits for `runner.hello` after the upgrade before it closes the socket. */
export const RUNNER_HELLO_TIMEOUT_MS = 10_000;

/** How long a rotated runner key keeps working after `key.rotate`, so a reconnect during the swap succeeds. */
export const KEY_ROTATION_OVERLAP_MS = 10 * 60_000;

/**
 * The close codes of a runner socket. A bad key never gets a socket: the upgrade is refused with HTTP 401.
 * A runner reconnects after every close (backoff 1 s to 60 s with jitter), at the slowest pace after 4001–4003.
 */
export const RUNNER_CLOSE = {
  /** A frame over `RUNNER_FRAME_MAX_BYTES` (RFC 6455, "message too big"; `ws` closes with it by itself). */
  frameTooLarge: 1009,
  /** The runner key was revoked or its rotation overlap ended, or the machine was removed, while connected. */
  unauthorized: 4001,
  /** `runner.hello` named a protocol version the server does not speak. */
  unsupportedProtocol: 4002,
  /** The runner's version is below `server.hello`'s `minRunnerVersion` (sent just before the close). */
  runnerTooOld: 4003,
  /** A newer connection of the same machine took over this one. */
  replaced: 4004,
  /** No `runner.hello` within `RUNNER_HELLO_TIMEOUT_MS`. */
  helloTimeout: 4008,
} as const;

import { describe, expect, it } from 'vitest';
import * as constants from '../../src/runner-protocol/constants.ts';

describe('the runner protocol constants', () => {
  it('are the numbers of docs/runner-protocol.md', () => {
    expect({ ...constants }).toEqual({
      RUNNER_PROTOCOL_VERSION: 1,
      RUNNER_SUBPROTOCOL: 'mwc-runner.v1',
      RUNNER_WS_PATH: '/api/runner/ws',
      RUNNER_FRAME_MAX_BYTES: 262_144,
      EVENT_BATCH_MAX_EVENTS: 100,
      EVENT_BATCH_MAX_BYTES: 65_536,
      RUNNER_PING_MS: 20_000,
      RUNNER_HEARTBEAT_MS: 20_000,
      RUN_LEASE_MS: 90_000,
      JOB_OFFER_TTL_MS: 30_000,
      UNACKED_EVENTS_MAX: 500,
      MACHINE_SAMPLE_MS: 60_000,
      DEVBOX_KEEPALIVE_REFRESH_MS: 300_000,
      DEVBOX_KEEPALIVE_DURATION: '20 minutes',
      RUNNER_HELLO_TIMEOUT_MS: 10_000,
      KEY_ROTATION_OVERLAP_MS: 600_000,
      RUNNER_CLOSE: {
        frameTooLarge: 1009,
        unauthorized: 4001,
        unsupportedProtocol: 4002,
        runnerTooOld: 4003,
        replaced: 4004,
        helloTimeout: 4008,
      },
    });
  });

  it('keep the devbox keepalive in the long form, which devbox-keepalive reads', () => {
    expect(constants.DEVBOX_KEEPALIVE_DURATION).toMatch(/^\d+ minutes$/);
    expect(constants.DEVBOX_KEEPALIVE_REFRESH_MS).toBeLessThan(20 * 60_000);
  });
});

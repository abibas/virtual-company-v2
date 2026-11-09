/**
 * The machines tests' world: the API on a test database with the fake identity provider, one fixed clock, a runner
 * hub with short timeouts and its power control (the runner controllers', or this server's own on a `local` driver),
 * served on 127.0.0.1 and an ephemeral port (as `start` serves it, with the socket server), so `FakeRunner` connects
 * over a real WebSocket. Every runner a test connects is disconnected after it.
 */
import type { AddressInfo } from 'node:net';
import { migrateToLatest } from '@mwc/db/system';
import {
  captureLogger,
  createTestApp,
  createTestDb,
  FakeIdentityProvider,
  fixedClock,
  type LogLine,
  testConfig,
} from '@mwc/testkit';
import { FakeRunner, type FakeRunnerOptions } from '@mwc/testkit/runner';
import {
  createPowerControl,
  createRunnerHub,
  type HubOptions,
  type PowerControl,
  type RunnerHub,
} from '../../../src/modules/machines/index.ts';
import type { LocalPower } from '../../../src/platform/power/local.ts';
import type { AuthWorld } from '../platform/auth.ts';
import { eventually, listen } from '../platform/realtime.ts';

export { eventually } from '../platform/realtime.ts';

/** The hub's timeouts in these tests: short, so a hello timeout or a lost answer takes a fraction of a second. */
export const TEST_HUB: HubOptions = { helloTimeoutMs: 300, requestTimeoutMs: 400, closeTimeoutMs: 300 };

export interface MachinesWorld extends AuthWorld {
  readonly hub: RunnerHub;
  /** The app's power control: who drives the devboxes. */
  readonly control: PowerControl;
  /** Every line the app and the hub logged. */
  readonly logs: LogLine[];
  /** The runner socket's address: `ws://127.0.0.1:<port>/api/runner/ws`. */
  readonly url: string;
  /** A runner connected with this key (and options), disconnected after the test file. */
  connect(key: string, options?: Omit<FakeRunnerOptions, 'url' | 'key'>): Promise<FakeRunner>;
  /** Disconnects every runner connected so far. */
  disconnectAll(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The world, with `hub` options over `TEST_HUB`, this server's own power driver when `local` is given, and the runner
 * bundle it hands out at `runnerBundle` (the repository's otherwise).
 */
export async function machinesWorld(
  hubOptions: HubOptions = {},
  options: { readonly local?: LocalPower; readonly runnerBundle?: string } = {},
): Promise<MachinesWorld> {
  const clock = fixedClock();
  const fake = new FakeIdentityProvider({ clock });
  const testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
  const { logger, lines } = captureLogger();
  const hub = createRunnerHub({ db: testDb.handle, logger, clock }, { ...TEST_HUB, ...hubOptions });
  const port = testConfig.MWC_PORT;
  const control = createPowerControl({ hub, port, logger, local: options.local });
  const t = await createTestApp({
    db: testDb.handle,
    clock,
    identity: fake,
    logger,
    runnerHub: hub,
    powerControl: control,
    ...(options.runnerBundle === undefined ? {} : { runnerBundle: options.runnerBundle }),
  });
  const server = await listen(t.app.fetch);
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/runner/ws`;
  const runners: FakeRunner[] = [];
  const disconnectAll = async () => {
    const gone = runners.splice(0);
    await Promise.all(gone.map((runner) => runner.disconnect()));
    // The server sees each close a moment after the runner does: wait for it, then for the writes it queued.
    const machineIds = gone.flatMap((runner) =>
      runner.frames.of('server.hello').map((hello) => hello.machineId),
    );
    await eventually('the runners are gone from the hub', () => machineIds.every((id) => !hub.isOnline(id)));
    await hub.idle();
  };
  return {
    t,
    fake,
    clock,
    deps: { db: t.db, config: testConfig, logger, identity: fake },
    hub,
    control,
    logs: lines,
    url,
    async connect(key, options = {}) {
      const runner = new FakeRunner({ url, key, ...options });
      runners.push(runner);
      await runner.connect();
      return runner;
    },
    disconnectAll,
    async close() {
      await disconnectAll();
      await control.close();
      await hub.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await testDb.close();
    },
  };
}

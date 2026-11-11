/**
 * A server restart in the chats' tests (S5.4): a second app with its own runner hub on the same database, served on its
 * own port, as the server that comes up after the first one stopped; its runner socket's address, its logs, and its
 * close. The first app is left as it is: in these tests it is the stopped server, whose runner went to the new one.
 */
import type { AddressInfo } from 'node:net';
import { captureLogger, createTestApp } from '@mwc/testkit';
import { FakeRunner, type FakeRunnerOptions } from '@mwc/testkit/runner';
import { createRunnerHub } from '../../../src/modules/machines/index.ts';
import { TEST_HUB } from '../machines/world.ts';
import { listen } from '../platform/realtime.ts';
import type { ChatsWorld } from './world.ts';

export async function restartedServer(w: ChatsWorld) {
  const { logger, lines } = captureLogger();
  const hub = createRunnerHub({ db: w.t.db, logger, clock: w.clock }, TEST_HUB);
  const t = await createTestApp({
    db: w.t.db,
    clock: w.clock,
    identity: w.fake,
    logger,
    runnerHub: hub,
    keyring: w.keyring,
    providerFetch: w.provider.fetch,
  });
  const server = await listen(t.app.fetch);
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/runner/ws`;
  const runners: FakeRunner[] = [];
  return {
    hub,
    logs: lines,
    /** A runner of the machine of `key` connected to the new server. */
    async connect(key: string, options: Omit<FakeRunnerOptions, 'url' | 'key'> = {}) {
      const runner = new FakeRunner({ url, key, ...options });
      runners.push(runner);
      await runner.connect();
      return runner;
    },
    async close() {
      await Promise.all(runners.map((runner) => runner.disconnect()));
      await hub.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

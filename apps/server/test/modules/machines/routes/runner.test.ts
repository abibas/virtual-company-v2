import { RUNNER_PROTOCOL_VERSION, RUNNER_SUBPROTOCOL } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { enroll, machinesPath } from '../../../fixtures/machines/machines.ts';
import { type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { newApiKey, seedApiKey } from '../../../fixtures/platform/auth.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** The status an upgrade was refused with, read from the client's `unexpected-response`. */
function refusedWith(headers: Record<string, string>, protocols?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(w.url, protocols, { headers });
    // Cutting a socket that never opened is an error event: expected here.
    socket.on('error', () => {});
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => reject(new Error('The upgrade was accepted')));
  });
}

describe('GET /api/runner/ws', () => {
  it("opens a socket for a runner key and answers its hello with its machine's id", async () => {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    expect(runner.frames.of('server.hello')).toEqual([
      {
        type: 'server.hello',
        protocol: RUNNER_PROTOCOL_VERSION,
        minRunnerVersion: '0.0.0',
        machineId,
        resume: true,
      },
    ]);
    expect((await as(w, company.owner)('GET', machinesPath(company, `/${machineId}`))).body).toMatchObject({
      status: 'online',
    });
  });

  it('refuses the upgrade with HTTP 401, no socket, for no key, a bad key, a personal key or a session', async () => {
    const company = await membersCompany(w);
    const personal = await seedApiKey(w.t.db, { ...company, principalId: company.owner.principalId });
    for (const key of [undefined, newApiKey('rk'), personal.key, `fake:${company.owner.subject}`]) {
      await expect(
        new FakeRunner({ url: w.url, ...(key === undefined ? {} : { key }) }).connect(),
      ).rejects.toThrow(/Unexpected server response: 401/);
    }
  });

  it('refuses an upgrade that does not speak mwc-runner.v1 (400), and is no route without an upgrade (404)', async () => {
    const company = await membersCompany(w);
    const { runnerKey } = await enroll(w, company);
    const authorization = `Bearer ${runnerKey}`;
    expect(await refusedWith({ authorization })).toBe(400);
    expect(await refusedWith({ authorization }, 'mwc-runner.v0')).toBe(400);
    const plain = await fetch(w.url.replace('ws://', 'http://'), {
      headers: { authorization, 'sec-websocket-protocol': RUNNER_SUBPROTOCOL },
    });
    expect(plain.status).toBe(404);
  });
});

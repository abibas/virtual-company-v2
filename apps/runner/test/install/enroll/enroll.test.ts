import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRunnerConfig } from '../../../src/config.ts';
import { DEVBOX_KEEPALIVE_BIN } from '../../../src/hold/driver.ts';
import {
  checkInput,
  DEFAULT_SLOTS,
  enrollMachine,
  enrollRequest,
  httpBase,
  postEnroll,
} from '../../../src/install/enroll/enroll.ts';
import { enrollWorld, type Fetch, json, noFetch, SERVER, testHost } from '../../fixtures/host.ts';

let w: Awaited<ReturnType<typeof enrollWorld>>;
beforeAll(async () => {
  w = await enrollWorld();
});
afterAll(() => w.t.close());

const TOKEN = `mwc_et_${'a1B2'.repeat(8)}`;

describe('the input', () => {
  it('needs a server address, an enrollment token, a name of 1–80 characters and 0–64 slots', () => {
    expect(checkInput({ server: `${SERVER}/`, token: TOKEN })).toEqual({
      server: SERVER,
      via: SERVER,
      token: TOKEN,
      name: undefined,
      slots: DEFAULT_SLOTS,
    });
    expect(checkInput({ server: SERVER, token: TOKEN, name: '  Mac  ', slots: '4' })).toMatchObject({
      name: 'Mac',
      slots: 4,
    });
    expect(checkInput({ server: SERVER, via: 'http://127.0.0.1:9954/', token: TOKEN })).toMatchObject({
      server: SERVER,
      via: 'http://127.0.0.1:9954',
    });
    const refused = [
      [{ token: TOKEN }, '--server needs the server address'],
      [{ server: 'ftp://x', token: TOKEN }, '--server needs the server address'],
      [{ server: SERVER }, '--token needs an enrollment token'],
      [{ server: SERVER, via: 'nowhere', token: TOKEN }, '--via needs the address this install reaches'],
      [{ server: SERVER, token: 'mwc_pk_x' }, '--token needs an enrollment token'],
      [{ server: SERVER, token: TOKEN, name: ' ' }, '--name needs 1 to 80 characters'],
      [{ server: SERVER, token: TOKEN, name: 'n'.repeat(81) }, '--name needs 1 to 80 characters'],
      [{ server: SERVER, token: TOKEN, slots: '65' }, '--slots needs a whole number from 0 to 64'],
      [{ server: SERVER, token: TOKEN, slots: '1.5' }, '--slots needs a whole number from 0 to 64'],
    ] as const;
    for (const [input, message] of refused) {
      expect(() => checkInput(input)).toThrow(
        expect.objectContaining({ code: 64, message: expect.stringContaining(message) }),
      );
    }
  });

  it('reaches the server over HTTP whatever scheme the address has', () => {
    expect(httpBase('wss://corp.example.test/')).toBe('https://corp.example.test');
    expect(httpBase('ws://localhost:9950')).toBe('http://localhost:9950');
    expect(httpBase('https://corp.example.test/mwc')).toBe('https://corp.example.test/mwc');
  });
});

describe('the request', () => {
  it('says what the machine is; a devbox names its instance, zone and project', async () => {
    const fetch: Fetch = async (url) =>
      new Response(
        url.endsWith('instance/name')
          ? 'dev-ihorherasko'
          : url.endsWith('instance/zone')
            ? 'projects/1/zones/europe-west1-b'
            : 'airia-devbox',
      );
    const { host } = testHost({ files: [DEVBOX_KEEPALIVE_BIN], fetch });
    expect(await enrollRequest(host, TOKEN)).toEqual({
      token: TOKEN,
      name: 'Airia devbox',
      kind: 'vm',
      os: 'linux',
      arch: 'arm64',
      hostname: 'ihors-mac.local',
      unixUser: 'ihor',
      runnerVersion: '0.1.0',
      claudeVersion: null,
      provider: 'airia_devbox',
      providerRef: { instance: 'dev-ihorherasko', zone: 'europe-west1-b', project: 'airia-devbox' },
    });
  });

  it('never asks a container for a provider, and refuses what the server would not take', async () => {
    const container = testHost({ files: ['/.dockerenv', DEVBOX_KEEPALIVE_BIN], fetch: noFetch });
    expect(await enrollRequest(container.host, TOKEN, 'runner-local')).toMatchObject({
      name: 'runner-local',
      kind: 'container',
      provider: 'none',
      providerRef: null,
    });
    const { host } = testHost({ platform: 'darwin' });
    await expect(enrollRequest({ ...host, version: 'dev' }, TOKEN)).rejects.toThrow(
      'this machine cannot enroll as it is: runnerVersion: a version such as 1.2.3',
    );
  });
});

describe('enrolling against the API', () => {
  it('trades the token for the machine and its key, and writes runner.json (0600) with them', async () => {
    const { host, home } = testHost({ platform: 'darwin', fetch: w.fetch });
    const enrolled = await enrollMachine(host, { server: SERVER, token: await w.token(), name: 'This Mac' });
    const configPath = join(home, '.config/mwc/runner.json');
    expect(enrolled).toMatchObject({ configPath, kind: 'laptop', provider: 'none' });
    const config = readRunnerConfig(configPath);
    expect(config).toEqual({
      serverUrl: SERVER,
      machineId: expect.any(String),
      companyId: w.company.id,
      runnerKey: expect.stringMatching(/^mwc_rk_/),
      name: 'This Mac',
      slots: DEFAULT_SLOTS,
    });
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.config/mwc')).mode & 0o777).toBe(0o700);
    const machine = (await w.machines()).find((m) => m.id === config.machineId);
    expect(machine).toMatchObject({
      name: 'This Mac',
      kind: 'laptop',
      os: 'darwin',
      hostname: 'ihors-mac.local',
    });
  });

  it('refuses to enroll twice unless forced, and a used token with the unauthorized code', async () => {
    const { host } = testHost({ fetch: w.fetch });
    const token = await w.token();
    await enrollMachine(host, { server: SERVER, token });
    await expect(enrollMachine(host, { server: SERVER, token: await w.token() })).rejects.toThrow(
      /this machine is already enrolled \(.*runner\.json\)\. Pass --force/,
    );
    await expect(enrollMachine(host, { server: SERVER, token, force: true })).rejects.toThrow(
      expect.objectContaining({
        code: 77,
        message: expect.stringContaining('the server refused the enrollment token'),
      }),
    );
    const again = await enrollMachine(host, {
      server: SERVER,
      token: await w.token(),
      force: true,
      slots: '0',
    });
    expect(again.config.slots).toBe(0);
  });

  it('says it cannot write runner.json, with the configuration code, after the server answered', async () => {
    const { host, home } = testHost({ fetch: w.fetch, env: {} });
    mkdirSync(join(home, '.config/mwc/runner.json'), { recursive: true });
    await expect(
      enrollMachine(host, { server: SERVER, token: await w.token(), force: true }),
    ).rejects.toThrow(
      expect.objectContaining({ code: 78, message: expect.stringContaining('cannot write') }),
    );
  });
});

describe('the enrollment call', () => {
  const request = { token: TOKEN } as Parameters<typeof postEnroll>[2];
  const post = (fetch: Fetch) => postEnroll(testHost({ fetch }).host, SERVER, request);

  it('says the server cannot be reached, with the reason', async () => {
    const refused: Fetch = () =>
      Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    await expect(post(refused)).rejects.toThrow(`cannot reach ${SERVER}: fetch failed (ECONNREFUSED)`);
    await expect(post(() => Promise.reject(new Error('aborted')))).rejects.toThrow(
      `cannot reach ${SERVER}: aborted`,
    );
  });

  it("passes on the server's refusal, and refuses an answer unlike the API's", async () => {
    const invalid = json(400, { error: { code: 'invalid_request', message: 'name: too long' } });
    await expect(post(async () => invalid)).rejects.toThrow(
      `${SERVER} refused the enrollment: name: too long`,
    );
    await expect(post(async () => new Response('<html>', { status: 502 }))).rejects.toThrow(
      'refused the enrollment: the server answered 502',
    );
    await expect(post(async () => json(201, { ok: true }))).rejects.toThrow(
      'does not answer like the mwc API',
    );
  });
});

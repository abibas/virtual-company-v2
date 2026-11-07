import { DEFAULT_BOX_RULES } from '@mwc/machines-core';
import { describe, expect, it } from 'vitest';
import { AiriaDevboxDriver, POWER_TIMEOUT_MS, QUERY_TIMEOUT_MS } from '../src/driver.ts';
import {
  ACCOUNT,
  type Answer,
  BOX,
  DESCRIBE,
  describeJson,
  fail,
  fakeRun,
  GET_ACCOUNT,
  LIST,
  listJson,
  NOT_FOUND_STDERR,
  ok,
  REAUTH_STDERR,
  REF,
  STOP,
  timedOut,
  UP,
  ZONE,
} from './fixtures/gce.ts';

/** A driver on a fake run answering by command line; `describes` are the box's statuses at each describe, in turn. */
function world(answers: Record<string, Answer>, describes: (string | Answer)[] = []) {
  const fake = fakeRun((line) => {
    if (line === DESCRIBE && describes.length > 0) {
      const next = describes.length > 1 ? describes.shift() : describes[0];
      return typeof next === 'string' ? ok(describeJson({ status: next })) : next;
    }
    return answers[line];
  });
  return { driver: new AiriaDevboxDriver({ run: fake.run }), ...fake };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string; detail?: string };
  }
  throw new Error('resolved');
}

describe('AiriaDevboxDriver: reading', () => {
  it('is the airia_devbox driver and reads a box with gcloud describe, in 30 s', async () => {
    const { driver, calls } = world({}, ['RUNNING']);
    expect(driver.provider).toBe('airia_devbox');
    expect(await driver.status(REF)).toEqual({
      status: 'running',
      size: 'm',
      hourlyCost: 0.268,
      rules: DEFAULT_BOX_RULES,
    });
    expect(calls).toEqual([
      {
        command: 'gcloud',
        args: [
          'compute',
          'instances',
          'describe',
          BOX,
          '--project',
          'airia-devbox',
          '--zone',
          ZONE,
          '--format=json',
        ],
        timeoutMs: QUERY_TIMEOUT_MS,
      },
    ]);
  });

  it('reads a box gcloud does not find as missing, and other failures as errors', async () => {
    expect(await world({}, [fail(NOT_FOUND_STDERR)]).driver.status(REF)).toEqual({
      status: 'missing',
      rules: null,
    });
    const login = await failure(world({}, [fail(REAUTH_STDERR)]).driver.status(REF));
    expect(login.code).toBe('needs_gcloud_login');
    expect(login.detail).not.toContain('ya29');
    expect((await failure(world({}, [timedOut()]).driver.status(REF))).code).toBe('timeout');
    expect((await failure(world({}, [ok('not json')]).driver.status(REF))).code).toBe('failed');
  });

  it('discovers the signed-in account’s boxes by their labels', async () => {
    const { driver, lines } = world({
      [GET_ACCOUNT]: ok(`${ACCOUNT}\n`),
      [LIST]: ok(listJson({ status: 'TERMINATED' }, { name: 'Bad_Name' })),
    });
    expect(await driver.discover()).toEqual([
      {
        ref: { instance: BOX, zone: ZONE, size: 'm' },
        status: 'stopped',
        size: 'm',
        hourlyCost: 0.268,
        rules: DEFAULT_BOX_RULES,
      },
    ]);
    expect(lines()).toEqual([GET_ACCOUNT, LIST]);
  });

  it('needs a gcloud sign-in to discover', async () => {
    const unset = world({ [GET_ACCOUNT]: ok('(unset)\n') });
    expect((await failure(unset.driver.discover())).code).toBe('needs_gcloud_login');
    const odd = world({ [GET_ACCOUNT]: ok('___@x.io') });
    expect((await failure(odd.driver.discover())).code).toBe('needs_gcloud_login');
    const expired = world({ [GET_ACCOUNT]: ok(ACCOUNT), [LIST]: fail(REAUTH_STDERR) });
    expect((await failure(expired.driver.discover())).code).toBe('needs_gcloud_login');
  });

  it('reports a missing gcloud or airia CLI', async () => {
    const enoent = Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' });
    expect((await failure(world({}, [enoent]).driver.status(REF))).code).toBe('cli_missing');
    expect((await failure(world({}, [fail('env: gcloud: not here', 127)]).driver.status(REF))).code).toBe(
      'cli_missing',
    );
    const odd = await failure(world({}, [new Error('EPERM')]).driver.status(REF));
    expect(odd).toMatchObject({ code: 'failed', message: 'gcloud could not be started.' });
  });
});

describe('AiriaDevboxDriver: power', () => {
  it('starts a stopped box with airia devbox up --no-wait in 180 s, then reads it again', async () => {
    const { driver, lines, calls } = world({ [GET_ACCOUNT]: ok(ACCOUNT), [UP]: ok('==> starting') }, [
      'TERMINATED',
      'STAGING',
    ]);
    expect((await driver.start(REF)).status).toBe('starting');
    expect(lines()).toEqual([DESCRIBE, GET_ACCOUNT, UP, DESCRIBE]);
    expect(calls[2]?.timeoutMs).toBe(POWER_TIMEOUT_MS);
  });

  it('stops a running box with airia devbox stop', async () => {
    const { driver, lines } = world({ [GET_ACCOUNT]: ok(ACCOUNT), [STOP]: ok() }, ['RUNNING', 'STOPPING']);
    expect((await driver.stop(REF)).status).toBe('stopping');
    expect(lines()).toEqual([DESCRIBE, GET_ACCOUNT, STOP, DESCRIBE]);
  });

  it('runs nothing for a box already up or down', async () => {
    for (const status of ['RUNNING', 'PROVISIONING']) {
      const { driver, lines } = world({}, [status]);
      await driver.start(REF);
      expect(lines()).toEqual([DESCRIBE]);
    }
    for (const status of ['TERMINATED', 'STOPPING']) {
      const { driver, lines } = world({}, [status]);
      await driver.stop(REF);
      expect(lines()).toEqual([DESCRIBE]);
    }
  });

  it('never runs the CLI for a missing box (it would create one) or for another account’s box', async () => {
    const missing = world({}, [fail(NOT_FOUND_STDERR)]);
    const notFound = await failure(missing.driver.start(REF));
    expect(notFound.code).toBe('not_found');
    expect(notFound.message).toContain('airia devbox up');
    expect(missing.lines()).toEqual([DESCRIBE]);

    const other = world({ [GET_ACCOUNT]: ok('someone@airia.com') }, ['TERMINATED']);
    const refused = await failure(other.driver.start(REF));
    expect(refused).toMatchObject({ code: 'failed' });
    expect(refused.message).toContain('dev-someone');
    expect(other.lines()).toEqual([DESCRIBE, GET_ACCOUNT]);
  });

  it('maps the CLI’s failures: a stockout, an expired sign-in, a timeout, a missing CLI', async () => {
    const answers = (up: Answer) => world({ [GET_ACCOUNT]: ok(ACCOUNT), [UP]: up }, ['TERMINATED']);
    const stockout = fail("error: can't start dev-x: GCP has no capacity for it in us-central1-a right now");
    expect((await failure(answers(stockout).driver.start(REF))).code).toBe('stockout_or_quota');
    const expired = fail('error: your gcloud credentials have expired or are missing.');
    expect((await failure(answers(expired).driver.start(REF))).code).toBe('needs_gcloud_login');
    expect((await failure(answers(timedOut()).driver.start(REF))).code).toBe('timeout');
    const enoent = Object.assign(new Error('spawn airia ENOENT'), { code: 'ENOENT' });
    expect(await failure(answers(enoent).driver.start(REF))).toMatchObject({
      code: 'cli_missing',
      message: 'airia is not installed on the controlling machine.',
    });
    const odd = await failure(answers(fail('boom')).driver.start(REF));
    expect(odd).toMatchObject({ code: 'failed', message: 'Starting the box failed.', detail: 'boom' });
  });

  it('uses the commands, project and timeouts it is given', async () => {
    const fake = fakeRun((line) =>
      line.startsWith('/g/gcloud compute instances describe dev-ihor-herasko --project other')
        ? ok(describeJson({ status: 'TERMINATED' }))
        : line === '/g/gcloud config get-value account'
          ? ok(ACCOUNT)
          : line === '/a/airia devbox up --no-wait'
            ? ok()
            : undefined,
    );
    const driver = new AiriaDevboxDriver({
      run: fake.run,
      airia: '/a/airia',
      gcloud: '/g/gcloud',
      project: 'other',
      powerTimeoutMs: 5,
      queryTimeoutMs: 1,
    });
    await driver.start(REF);
    expect(fake.calls.map((call) => call.timeoutMs)).toEqual([1, 1, 5, 1]);
  });
});

describe('AiriaDevboxDriver: setTimezone', () => {
  const ADD = `gcloud compute instances add-metadata ${BOX} --project airia-devbox --zone ${ZONE} --metadata devbox-tz=Europe/Kyiv`;

  it('writes devbox-tz with gcloud add-metadata and reads the box again', async () => {
    const items = [{ key: 'devbox-tz', value: 'Europe/Kyiv' }];
    const { driver, lines } = world({ [ADD]: ok(), [DESCRIBE]: ok(describeJson({ items })) });
    expect((await driver.setTimezone(REF, 'Europe/Kyiv')).rules?.timezone).toBe('Europe/Kyiv');
    expect(lines()).toEqual([ADD, DESCRIBE]);
  });

  it('refuses a name that is not a time zone without running anything, and maps gcloud’s failures', async () => {
    const { driver, lines } = world({});
    expect(await failure(driver.setTimezone(REF, 'Kyiv,evil=1'))).toMatchObject({ code: 'failed' });
    expect(lines()).toEqual([]);
    const gone = world({ [ADD]: fail(NOT_FOUND_STDERR.replace('describe', 'add-metadata')) });
    expect((await failure(gone.driver.setTimezone(REF, 'Europe/Kyiv'))).code).toBe('not_found');
  });
});

describe('AiriaDevboxDriver: tunnelCommand', () => {
  const ports = { remotePort: 9950, localPort: 9950 };

  it('is plain gcloud compute ssh over IAP with the reverse forward, as an argument array, and runs nothing', () => {
    const fake = fakeRun(() => undefined);
    const driver = new AiriaDevboxDriver({ run: fake.run, gcloud: '/opt/homebrew/bin/gcloud' });
    expect(driver.tunnelCommand(REF, ports)).toEqual({
      command: '/opt/homebrew/bin/gcloud',
      args: [
        'compute',
        'ssh',
        BOX,
        '--project',
        'airia-devbox',
        '--zone',
        ZONE,
        '--tunnel-through-iap',
        '--quiet',
        '--strict-host-key-checking=no',
        '--',
        '-N',
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=3',
        '-o',
        'BatchMode=yes',
        '-R',
        '127.0.0.1:9950:127.0.0.1:9950',
      ],
    });
    expect(fake.calls).toEqual([]);
  });

  it('forwards the ports it is given, in its project, with the environment it was given', () => {
    const env = { PATH: '/g:/usr/bin', HOME: '/Users/ihor' };
    const driver = new AiriaDevboxDriver({ run: fakeRun(() => undefined).run, project: 'other', env });
    const tunnel = driver.tunnelCommand(REF, { remotePort: 9963, localPort: 9960 });
    expect(tunnel.command).toBe('gcloud');
    expect(tunnel.args.slice(3, 5)).toEqual(['--project', 'other']);
    expect(tunnel.args.at(-1)).toBe('127.0.0.1:9963:127.0.0.1:9960');
    expect(tunnel.args.some((arg) => /\s|'|"/.test(arg))).toBe(false);
    expect(tunnel.env).toBe(env);
  });
});

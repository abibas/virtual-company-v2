import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_DATABASE_URL,
  type DevChild,
  type DevDeps,
  devPlan,
  type Env,
  linePrefixer,
  postgresDown,
  postgresUp,
  runDev,
  type Service,
  type Step,
  systemDevDeps,
} from '../src/dev.ts';

describe('devPlan', () => {
  it('starts the compose Postgres, migrates, then runs the server and the web dev server', () => {
    const plan = devPlan({});
    expect(plan.env).toEqual({ DATABASE_URL: DEV_DATABASE_URL, NODE_ENV: 'development' });
    expect(DEV_DATABASE_URL).toBe('postgres://mwc:mwc@localhost:9952/mwc');
    expect(plan.setup).toEqual([
      {
        label: 'postgres',
        command: 'docker',
        args: ['compose', '-f', 'deploy/compose.yml', 'up', '-d', '--wait', 'postgres'],
      },
      { label: 'migrate', command: process.execPath, args: ['packages/db/scripts/migrate.ts'] },
    ]);
    expect(plan.services).toEqual([
      { name: 'server', command: process.execPath, args: ['--watch', 'apps/server/src/main.ts'] },
      { name: 'web', command: process.execPath, args: ['node_modules/vite/bin/vite.js'], cwd: 'apps/web' },
    ]);
  });

  it('uses a DATABASE_URL that is already set and then leaves Docker alone', () => {
    const plan = devPlan({ DATABASE_URL: 'postgres://me@db.internal/mwc', NODE_ENV: 'test' });
    expect(plan.env).toEqual({ DATABASE_URL: 'postgres://me@db.internal/mwc', NODE_ENV: 'test' });
    expect(plan.setup.map((step) => step.label)).toEqual(['migrate']);
  });
});

describe('linePrefixer', () => {
  it('prefixes whole lines, keeps a partial line until it ends, and flushes the rest', () => {
    const out: string[] = [];
    const prefix = linePrefixer('web', (s) => out.push(s));
    prefix.write('one\ntw');
    prefix.write('o\r\nthree');
    expect(out).toEqual(['web │ one\n', 'web │ two\n']);
    prefix.flush();
    prefix.flush();
    expect(out).toEqual(['web │ one\n', 'web │ two\n', 'web │ three\n']);
  });
});

/** Fake processes: steps succeed unless listed, services run until killed or ended by the test. */
function fakeDeps(options: { env?: Env; failing?: string[] } = {}) {
  const steps: Array<{ step: Step; env: Env }> = [];
  const started: Array<{ service: Service; env: Env; output: (chunk: string) => void }> = [];
  const killed: Array<{ name: string; signal: string }> = [];
  const exits = new Map<string, (code: number | null) => void>();
  let stop: (() => void) | undefined;
  let unsubscribed = false;
  const deps: DevDeps = {
    env: options.env ?? {},
    runStep(step, env) {
      steps.push({ step, env });
      return !options.failing?.includes(step.label);
    },
    start(service, env, output) {
      started.push({ service, env, output });
      const child: DevChild = {
        onExit: (callback) => exits.set(service.name, callback),
        kill: (signal) => {
          killed.push({ name: service.name, signal });
          // A killed service exits right away, as a real one would after its shutdown.
          queueMicrotask(() => exits.get(service.name)?.(null));
        },
      };
      return child;
    },
    onStop(handler) {
      stop = handler;
      return () => {
        unsubscribed = true;
      };
    },
  };
  return {
    deps,
    steps,
    started,
    killed,
    exit: (name: string, code: number | null) => exits.get(name)?.(code),
    stop: () => stop?.(),
    unsubscribed: () => unsubscribed,
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) }, out, err };
}

describe('runDev', () => {
  it('runs the setup with DATABASE_URL filled in, starts both services and stops both on Ctrl-C', async () => {
    const fake = fakeDeps({ env: { PATH: '/bin' } });
    const c = capture();
    const done = runDev(new Set(), c.io, fake.deps);
    expect(fake.steps.map((s) => s.step.label)).toEqual(['postgres', 'migrate']);
    expect(fake.steps[1]?.env).toMatchObject({ PATH: '/bin', DATABASE_URL: DEV_DATABASE_URL });
    expect(fake.started.map((s) => s.service.name)).toEqual(['server', 'web']);
    expect(fake.started[0]?.env.DATABASE_URL).toBe(DEV_DATABASE_URL);

    fake.started[0]?.output('listening\n');
    fake.started[1]?.output('ready in 300 ms\n');
    expect(c.out).toContain('server │ listening\n');
    expect(c.out).toContain('web    │ ready in 300 ms\n');

    fake.stop();
    fake.stop(); // a second Ctrl-C changes nothing
    expect(await done).toBe(0);
    expect(fake.killed).toEqual([
      { name: 'server', signal: 'SIGTERM' },
      { name: 'web', signal: 'SIGTERM' },
    ]);
    expect(fake.unsubscribed()).toBe(true);
    expect(c.out.join('')).toContain('Postgres keeps running');
  });

  it('stops at the first failed setup step and starts nothing', async () => {
    const fake = fakeDeps({ failing: ['postgres'] });
    const c = capture();
    expect(await runDev(new Set(), c.io, fake.deps)).toBe(1);
    expect(fake.steps.map((s) => s.step.label)).toEqual(['postgres']);
    expect(fake.started).toEqual([]);
    expect(c.err.join('')).toContain('mwc dev: postgres failed');
  });

  it('stops the other service and fails when one exits on its own', async () => {
    const fake = fakeDeps();
    const c = capture();
    const done = runDev(new Set(), c.io, fake.deps);
    fake.started[1]?.output('Port 9951 is already in use');
    fake.exit('web', 1);
    expect(await done).toBe(1);
    expect(fake.killed).toEqual([{ name: 'server', signal: 'SIGTERM' }]);
    expect(c.out).toContain('web    │ Port 9951 is already in use\n');
    expect(c.err.join('')).toContain('web exited (1)');
  });

  it('fails even when a service exits with 0 or by a signal on its own', async () => {
    for (const code of [0, null]) {
      const fake = fakeDeps();
      const done = runDev(new Set(), capture().io, fake.deps);
      fake.exit('server', code);
      expect(await done).toBe(1);
    }
  });

  it('with --down stops the dev Postgres and nothing else', async () => {
    const fake = fakeDeps();
    expect(await runDev(new Set(['down']), capture().io, fake.deps)).toBe(0);
    expect(fake.steps.map((s) => s.step)).toEqual([postgresDown]);
    expect(postgresDown.args).toEqual(['compose', '-f', 'deploy/compose.yml', 'down']);
    expect(postgresUp.args).toContain('--wait');
    const failing = fakeDeps({ failing: ['postgres down'] });
    expect(await runDev(new Set(['down']), capture().io, failing.deps)).toBe(1);
  });
});

describe('systemDevDeps (real processes, kept to two short node runs)', () => {
  const repoRoot = resolve(import.meta.dirname, '../../..');

  it('runs a step with the given environment and reports its exit status', () => {
    const deps = systemDevDeps(repoRoot, {}, false);
    const step = (code: number): Step => ({
      label: 'probe',
      command: process.execPath,
      args: ['-e', `process.exit(process.env.MWC_PROBE === 'yes' ? ${code} : 9)`],
    });
    expect(deps.runStep(step(0), { MWC_PROBE: 'yes' })).toBe(true);
    expect(deps.runStep({ label: 'missing', command: 'mwc-no-such-command', args: [] }, {})).toBe(false);
  });

  it('starts a service, hands over its stdout and stderr, and reports its exit code once', async () => {
    const deps = systemDevDeps(repoRoot, {}, true);
    const chunks: string[] = [];
    const child = deps.start(
      {
        name: 'probe',
        command: process.execPath,
        args: ['-e', 'console.log("out " + process.env.FORCE_COLOR); console.error("err"); process.exit(3)'],
      },
      { PATH: process.env.PATH },
      (chunk) => chunks.push(chunk),
    );
    const code = await new Promise<number | null>((done) => child.onExit(done));
    expect(code).toBe(3);
    expect(chunks.join('')).toContain('out 1');
    expect(chunks.join('')).toContain('err');
    expect(() => child.kill('SIGTERM')).not.toThrow();
  });

  it('reports a command that cannot start as exit 127', async () => {
    const deps = systemDevDeps(repoRoot, {}, false);
    const chunks: string[] = [];
    const child = deps.start({ name: 'missing', command: 'mwc-no-such-command', args: [] }, {}, (c) =>
      chunks.push(c),
    );
    expect(await new Promise<number | null>((done) => child.onExit(done))).toBe(127);
    expect(chunks.join('')).toContain('ENOENT');
  });

  it('subscribes to SIGINT and SIGTERM and unsubscribes again', () => {
    const deps = systemDevDeps(repoRoot);
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const unsubscribe = deps.onStop(() => {});
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(
      before.map((n) => n + 1),
    );
    unsubscribe();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
});

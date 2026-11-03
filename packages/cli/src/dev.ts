/**
 * `mwc dev`: one command for local development. It starts the dev Postgres (deploy/compose.yml,
 * 9952) and waits for it to be healthy, applies the migrations, then runs the API (9950,
 * `node --watch`) and the web dev server (9951, Vite) side by side with their output prefixed.
 * Ctrl-C stops both and leaves Postgres running; `mwc dev --down` stops it (the volume stays).
 * Everything that touches the system goes through `DevDeps`, so the plan and the supervision are
 * unit-tested with fakes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PORTS } from '@mwc/shared/ports';

export type Env = Readonly<Record<string, string | undefined>>;

/** The dev compose file (relative to the repo root) and the database URL it serves. */
export const DEV_COMPOSE_FILE = 'deploy/compose.yml';
export const DEV_DATABASE_URL = `postgres://mwc:mwc@localhost:${PORTS.postgres}/mwc`;

/** A process that runs to completion with inherited output, from the repo root or `cwd` under it. */
export interface Step {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Added to the environment of this step only. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A long-running process whose output is shown line by line behind its name. */
export interface Service {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface DevPlan {
  /** Added to every step's and service's environment. */
  readonly env: Readonly<Record<string, string>>;
  readonly setup: readonly Step[];
  readonly services: readonly Service[];
}

export const postgresUp: Step = {
  label: 'postgres',
  command: 'docker',
  args: ['compose', '-f', DEV_COMPOSE_FILE, 'up', '-d', '--wait', 'postgres'],
};

export const postgresDown: Step = {
  label: 'postgres down',
  command: 'docker',
  args: ['compose', '-f', DEV_COMPOSE_FILE, 'down'],
};

/**
 * What `mwc dev` runs. Without DATABASE_URL it uses the compose Postgres (and starts it); with
 * DATABASE_URL set it uses that database and leaves Docker alone.
 */
export function devPlan(env: Env): DevPlan {
  const external = Boolean(env.DATABASE_URL);
  return {
    env: { DATABASE_URL: env.DATABASE_URL || DEV_DATABASE_URL, NODE_ENV: env.NODE_ENV || 'development' },
    setup: [
      ...(external ? [] : [postgresUp]),
      { label: 'migrate', command: process.execPath, args: ['packages/db/scripts/migrate.ts'] },
    ],
    services: [
      { name: 'server', command: process.execPath, args: ['--watch', 'apps/server/src/main.ts'] },
      { name: 'web', command: process.execPath, args: ['node_modules/vite/bin/vite.js'], cwd: 'apps/web' },
    ],
  };
}

/** Splits a stream of chunks into lines and writes each as `<label> │ <line>`; `flush()` ends a partial line. */
export function linePrefixer(label: string, write: (s: string) => void) {
  let pending = '';
  return {
    write(chunk: string) {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) write(`${label} │ ${line.replace(/\r$/, '')}\n`);
    },
    flush() {
      if (pending !== '') write(`${label} │ ${pending}\n`);
      pending = '';
    },
  };
}

export interface DevChild {
  /** Called once when the process has exited (null code: killed by a signal). */
  onExit(callback: (code: number | null) => void): void;
  kill(signal: NodeJS.Signals): void;
}

export interface DevIo {
  stdout(s: string): void;
  stderr(s: string): void;
}

export interface DevDeps {
  readonly env: Env;
  /** Runs a step to completion with inherited output; true when it exited 0. */
  runStep(step: Step, env: Env): boolean;
  /** Starts a service; its stdout and stderr chunks go to `output`. */
  start(service: Service, env: Env, output: (chunk: string) => void): DevChild;
  /** Calls `handler` on Ctrl-C (SIGINT) or SIGTERM; returns the unsubscribe function. */
  onStop(handler: () => void): () => void;
}

/** Runs the plan: setup steps in order (stop at the first failure), then the services until one ends or Ctrl-C. */
export async function runDev(flags: ReadonlySet<string>, io: DevIo, deps: DevDeps): Promise<number> {
  if (flags.has('down')) {
    io.stdout(`▶ ${postgresDown.label}\n`);
    return deps.runStep(postgresDown, deps.env) ? 0 : 1;
  }
  const plan = devPlan(deps.env);
  const env: Env = { ...deps.env, ...plan.env };
  for (const step of plan.setup) {
    io.stdout(`▶ ${step.label}\n`);
    if (!deps.runStep(step, { ...env, ...step.env })) {
      io.stderr(`✗ mwc dev: ${step.label} failed\n`);
      return 1;
    }
  }
  io.stdout(
    `▶ server on http://localhost:${PORTS.api}, web on http://localhost:${PORTS.web}\n` +
      '  Ctrl-C stops both; Postgres keeps running (mwc dev --down stops it)\n',
  );

  const width = Math.max(...plan.services.map((service) => service.name.length));
  return new Promise<number>((resolve) => {
    let running = plan.services.length;
    let stopping = false;
    let result = 0;
    const children: DevChild[] = [];
    const stopAll = (except?: DevChild) => {
      for (const child of children) if (child !== except) child.kill('SIGTERM');
    };
    const unsubscribe = deps.onStop(() => {
      if (stopping) return;
      stopping = true;
      io.stdout('\n▶ stopping server and web\n');
      stopAll();
    });
    for (const service of plan.services) {
      const prefix = linePrefixer(service.name.padEnd(width), io.stdout);
      const child = deps.start(service, env, (chunk) => prefix.write(chunk));
      children.push(child);
      child.onExit((code) => {
        prefix.flush();
        running--;
        if (!stopping) {
          // A service ended on its own (crash, port taken): stop the other and fail.
          stopping = true;
          result = code || 1;
          io.stderr(`✗ mwc dev: ${service.name} exited (${code ?? 'signal'}); stopping the rest\n`);
          stopAll(child);
        }
        if (running === 0) {
          unsubscribe();
          resolve(result);
        }
      });
    }
  });
}

/** The real processes: spawnSync for steps, spawn with piped output for services, process signals. */
export function systemDevDeps(
  repoRoot: string,
  env: Env = process.env,
  colour = Boolean(process.stdout.isTTY),
): DevDeps {
  return {
    env,
    runStep(step, stepEnv) {
      const result = spawnSync(step.command, step.args, {
        cwd: join(repoRoot, step.cwd ?? ''),
        env: stepEnv as NodeJS.ProcessEnv,
        stdio: 'inherit',
      });
      return result.status === 0;
    },
    start(service, serviceEnv, output) {
      const child = spawn(service.command, service.args, {
        cwd: join(repoRoot, service.cwd ?? ''),
        // Piped output is not a terminal; keep the colours when mwc dev itself prints to one.
        env: { ...serviceEnv, ...(colour ? { FORCE_COLOR: '1' } : {}) } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.setEncoding('utf8').on('data', output);
      child.stderr.setEncoding('utf8').on('data', output);
      let exited = false;
      const exits: Array<(code: number | null) => void> = [];
      const done = (code: number | null) => {
        if (exited) return;
        exited = true;
        for (const callback of exits) callback(code);
      };
      child.on('exit', (code) => done(code));
      child.on('error', (error) => {
        output(`${error.message}\n`);
        done(127);
      });
      return {
        onExit: (callback) => exits.push(callback),
        kill: (signal) => {
          if (!exited) child.kill(signal);
        },
      };
    },
    onStop(handler) {
      process.on('SIGINT', handler);
      process.on('SIGTERM', handler);
      return () => {
        process.off('SIGINT', handler);
        process.off('SIGTERM', handler);
      };
    },
  };
}

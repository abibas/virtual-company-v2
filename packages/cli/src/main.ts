/**
 * mwc command dispatch. `mwc.ts` is the executable entry; everything it does goes through
 * `main()` so the commands can be tested without spawning a process.
 *
 *   mwc check [--fast] [--full]      lint, typecheck every package, check db drift (migrations and the
 *                                    schema diagram), run the tests (with coverage unless --fast);
 *                                    --full adds the db and server tests on the dev Postgres (when
 *                                    Docker is available), the web build and the Playwright smoke
 *   mwc dev [--down]                 dev Postgres + migrations + API (9950) + web (9951); --down stops Postgres
 *   mwc ports [--slot N] [--path P]  print the port map, or the ports of a worktree slot
 *   mwc banned [--message FILE]      fail on a banned name (banned.ts) in the repository's files, or in
 *                                    a commit message file (the commit-msg hook)
 *   mwc help
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PORTS, SLOT_COUNT, slotFromPath, slotPorts } from '@mwc/shared/ports';
import { parseArgs } from './args.ts';
import {
  commitMessageText,
  formatHits,
  type ScanDeps,
  scanFiles,
  scanText,
  systemScanDeps,
} from './banned.ts';
import {
  DEV_COMPOSE_FILE,
  DEV_DATABASE_URL,
  postgresDown,
  postgresUp,
  runDev,
  type Step,
  systemDevDeps,
} from './dev.ts';

export interface MainIo {
  stdout(s: string): void;
  stderr(s: string): void;
  /** The directory relative paths are resolved against when `env.INIT_CWD` is not set. */
  readonly cwd: string;
  /** pnpm runs scripts from the package root and passes the caller's directory as `INIT_CWD`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * One step of `mwc check`: a label and the process to run from the repo root (or `cwd` under it), or,
 * with `run`, a check that runs inside this process (no process start; `command`/`args` then say how to
 * run the same check on its own).
 */
export type CheckStep = Step & { readonly run?: (io: MainIo) => boolean };

/** The banned-names scan of the repository's files, in this process (one `git ls-files`). */
export function bannedNames(io: MainIo, deps: ScanDeps = systemScanDeps(repoRoot)): boolean {
  const files = deps.listFiles();
  const hits = scanFiles({ listFiles: () => files, readFile: deps.readFile });
  if (hits.length > 0) {
    io.stderr(
      `${formatHits(hits)}Names from earlier versions never appear in this repository (CLAUDE.md).\n`,
    );
    return false;
  }
  io.stdout(`no banned names in ${files.length} files\n`);
  return true;
}

const bannedStep: CheckStep = {
  label: 'banned names',
  command: process.execPath,
  args: ['packages/cli/src/mwc.ts', 'banned'],
  run: (io) => bannedNames(io),
};

/** What the --full Postgres lane needs to know about the machine before it plans its steps. */
export interface FullLane {
  /** The Docker daemon answers; without it the Postgres lane is skipped. */
  readonly docker: boolean;
  /** The dev Postgres (deploy/compose.yml) is already up, e.g. under `mwc dev`; then it is left as it is. */
  readonly postgresRunning: boolean;
}

const NO_DOCKER: FullLane = { docker: false, postgresRunning: false };

/** The steps of `mwc check` for the given workspace package directories, in order. */
export function checkSteps(
  flags: ReadonlySet<string>,
  packageDirs: readonly string[],
  lane: FullLane = NO_DOCKER,
): CheckStep[] {
  const steps: CheckStep[] = [
    { label: 'biome', command: 'pnpm', args: ['exec', 'biome', 'check', '.'] },
    bannedStep,
  ];
  for (const dir of packageDirs) {
    steps.push({ label: `typecheck ${dir}`, command: 'pnpm', args: ['exec', 'tsc', '--noEmit', '-p', dir] });
  }
  if (packageDirs.includes('packages/db')) {
    // The migrations and schema diagram drift checks in one step, straight on Node (its TypeScript
    // support): one node process plus one drizzle-kit.
    steps.push({
      label: 'db drift',
      command: process.execPath,
      args: ['packages/db/scripts/check-drift.ts'],
    });
  }
  steps.push({
    label: 'tests',
    command: 'pnpm',
    args: ['exec', 'vitest', 'run', ...(flags.has('fast') ? [] : ['--coverage'])],
  });
  if (!flags.has('full')) return steps;

  // The tests again with TEST_DB=postgres: the db and server integration tests then run on the dev
  // Postgres through postgres.js, each on its own database created and dropped on that server
  // (@mwc/db/testing), never the dev database itself. All projects run, because Vitest 5 reports no
  // coverage when --project filters them; the cli and shared tests ignore TEST_DB (about a second).
  const postgres = lane.docker && packageDirs.includes('packages/db');
  if (postgres) {
    if (!lane.postgresRunning) steps.push(postgresUp);
    steps.push({
      label: 'tests on postgres',
      command: 'pnpm',
      args: [
        'exec',
        'vitest',
        'run',
        ...(flags.has('fast') ? [] : ['--coverage', '--coverage.reportsDirectory=coverage/postgres']),
      ],
      env: { TEST_DB: 'postgres', TEST_DATABASE_URL: DEV_DATABASE_URL },
    });
  }
  if (packageDirs.includes('apps/web')) {
    // Straight on Node from the web package (no pnpm or shell process in between): the production
    // build, then the Playwright smoke against it (which starts the in-memory API and vite preview).
    steps.push(
      {
        label: 'web build',
        command: process.execPath,
        args: ['node_modules/vite/bin/vite.js', 'build'],
        cwd: 'apps/web',
      },
      {
        label: 'e2e',
        command: process.execPath,
        args: ['node_modules/@playwright/test/cli.js', 'test'],
        cwd: 'apps/web',
      },
    );
  }
  // Leave the machine as it was: stop the dev Postgres only if this run started it.
  if (postgres && !lane.postgresRunning) steps.push(postgresDown);
  return steps;
}

/** Workspace package directories (relative to the repo root) that have a tsconfig.json. */
export function workspacePackages(root: string = repoRoot): string[] {
  const dirs: string[] = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir).sort()) {
      const dir = join(group, name);
      if (existsSync(join(root, dir, 'tsconfig.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * Runs one step with inherited stdio from the repo root (or its `cwd`), adding its `env`; true when it
 * exited 0. A step with `run` runs in this process instead.
 */
export function spawnStep(step: CheckStep, io: MainIo): boolean {
  if (step.run) return step.run(io);
  const result = spawnSync(step.command, step.args, {
    cwd: join(repoRoot, step.cwd ?? ''),
    stdio: 'inherit',
    ...(step.env ? { env: { ...process.env, ...step.env } } : {}),
  });
  if (result.error) {
    io.stderr(`${step.label}: ${result.error.message}\n`);
    return false;
  }
  return result.status === 0;
}

/** Asks Docker (two quick processes, only for --full) whether it runs and whether the dev Postgres is up. */
function detectLane(): FullLane {
  const docker =
    spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status === 0;
  if (!docker) return NO_DOCKER;
  const ps = spawnSync(
    'docker',
    ['compose', '-f', DEV_COMPOSE_FILE, 'ps', '--status', 'running', '-q', 'postgres'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  return { docker, postgresRunning: ps.status === 0 && ps.stdout.trim() !== '' };
}

export interface CheckDeps {
  readonly packageDirs: readonly string[];
  /** Runs one step with inherited stdio; true when it passed. */
  runStep(step: CheckStep, io: MainIo): boolean;
  /** Looks at Docker for the --full Postgres lane; not called without --full. */
  lane?(): FullLane;
}

/** `mwc check`: every step runs even after a failure, so one run shows every problem. */
export function runCheck(flags: ReadonlySet<string>, io: MainIo, deps?: CheckDeps): number {
  const {
    packageDirs,
    runStep,
    lane: detect,
  } = deps ?? {
    packageDirs: workspacePackages(),
    runStep: spawnStep,
    lane: detectLane,
  };
  let lane = NO_DOCKER;
  if (flags.has('full')) {
    lane = detect?.() ?? NO_DOCKER;
    if (!lane.docker) io.stdout('\n(--full: Docker is not available, so the Postgres lane is skipped)\n');
  }
  const failed: string[] = [];
  for (const step of checkSteps(flags, packageDirs, lane)) {
    io.stdout(`\n▶ ${step.label}\n`);
    if (!runStep(step, io)) failed.push(step.label);
  }
  if (failed.length > 0) {
    io.stderr(`\n✗ mwc check failed: ${failed.join(', ')}\n`);
    return 1;
  }
  io.stdout('\n✓ mwc check passed\n');
  return 0;
}

/** A `--slot` value: a whole number in 0..SLOT_COUNT-1, or undefined when it is not one. */
function parseSlot(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const slot = Number(value);
  return slot < SLOT_COUNT ? slot : undefined;
}

function ports(flags: ReadonlySet<string>, options: Readonly<Record<string, string>>, io: MainIo): number {
  if (flags.has('slot') || flags.has('path')) {
    io.stderr(`mwc ports: --${flags.has('slot') ? 'slot' : 'path'} needs a value\n`);
    return 2;
  }
  let slot: number | undefined;
  if (options.slot !== undefined) {
    slot = parseSlot(options.slot);
    if (slot === undefined) {
      io.stderr(`mwc ports: --slot must be a whole number in 0..${SLOT_COUNT - 1}, got "${options.slot}"\n`);
      return 2;
    }
  } else if (options.path !== undefined) {
    slot = slotFromPath(resolve(io.env?.INIT_CWD ?? io.cwd, options.path));
  }
  if (slot !== undefined) {
    const p = slotPorts(slot);
    io.stdout(`slot ${p.slot}: api ${p.api}, web ${p.web}, postgres ${p.postgres}\n`);
    return 0;
  }
  io.stdout(`${JSON.stringify(PORTS, null, 2)}\nworktree slots: 9960–9989 (mwc ports --slot N | --path P)\n`);
  return 0;
}

/** `mwc banned`: the repository's files, or with `--message FILE` that commit message file. */
function banned(
  flags: ReadonlySet<string>,
  options: Readonly<Record<string, string>>,
  io: MainIo,
  deps?: ScanDeps,
): number {
  if (flags.has('message')) {
    io.stderr('mwc banned: --message needs a file\n');
    return 2;
  }
  if (options.message === undefined) return bannedNames(io, deps) ? 0 : 1;
  let raw: string;
  try {
    // git runs hooks from the top of the work tree and passes the path relative to it.
    raw = readFileSync(resolve(io.cwd, options.message), 'utf8');
  } catch (error) {
    io.stderr(`mwc banned: cannot read ${options.message}: ${(error as Error).message}\n`);
    return 2;
  }
  const hits = scanText('commit message', commitMessageText(raw));
  if (hits.length === 0) return 0;
  io.stderr(`${formatHits(hits)}Names from earlier versions never appear in commit messages (CLAUDE.md).\n`);
  return 1;
}

const HELP = [
  'mwc commands:',
  '  check [--fast] [--full]        lint, banned names, typecheck, db drift, test (coverage unless --fast);',
  '                                 --full: tests on Postgres, web build, e2e',
  '  dev [--down]                   Postgres, migrations, API on 9950 and web on 9951; --down stops Postgres',
  '  ports [--slot N] [--path P]    the port map or a worktree slot',
  '  banned [--message FILE]        banned names in the repository, or in a commit message file',
  '  help',
  '',
].join('\n');

export interface MainDeps {
  /** `mwc dev` with its processes; the real ones by default. */
  dev?(flags: ReadonlySet<string>, io: MainIo): Promise<number>;
  /** The files `mwc banned` scans; git's by default. */
  scan?: ScanDeps;
}

const systemDev = (flags: ReadonlySet<string>, io: MainIo) =>
  runDev(flags, io, systemDevDeps(repoRoot, io.env ?? process.env));

/**
 * Run one `mwc` command; returns the process exit code (0 ok, 1 failed, 2 usage error), as a
 * promise for the long-running `dev`.
 */
export function main(argv: readonly string[], io: MainIo, deps: MainDeps = {}): number | Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'check':
      return runCheck(args.flags, io);
    case 'dev':
      return (deps.dev ?? systemDev)(args.flags, io);
    case 'ports':
      return ports(args.flags, args.options, io);
    case 'banned':
      return banned(args.flags, args.options, io, deps.scan);
    case undefined:
    case 'help':
      io.stdout(HELP);
      return 0;
    default:
      io.stderr(`unknown command: ${args.command}\n${HELP}`);
      return 2;
  }
}

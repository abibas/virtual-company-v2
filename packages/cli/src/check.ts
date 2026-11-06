/**
 * `mwc check`: the steps of each lane (fast, default, --full) and how they run. Steps run from the repo
 * root as processes with inherited output, except the banned-names and structure scans, which run in
 * this process on one shared file listing; the same listing gives the structure warnings it ends with.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cachedScanDeps, formatHits, type ScanDeps, scanFiles, systemScanDeps } from './banned.ts';
import { type FullLane, fullSteps, NO_DOCKER } from './check/full.ts';
import { DEV_COMPOSE_FILE, type Step } from './dev.ts';
import { type MainIo, REPO_ROOT } from './io.ts';
import { checkStructure, formatViolations } from './structure/check.ts';
import { coverageReader, formatSummary, warningsOf } from './structure/report.ts';
import { repoTree } from './structure/tree.ts';

/**
 * One step of `mwc check`: a label and the process to run from the repo root (or `cwd` under it), or,
 * with `run`, a check that runs inside this process (no process start; `command`/`args` then say how to
 * run the same check on its own).
 */
export type CheckStep = Step & { readonly run?: (io: MainIo) => boolean };

/** The banned-names scan of the repository's files, in this process (one `git ls-files`). */
export function bannedNames(io: MainIo, deps: ScanDeps = systemScanDeps(REPO_ROOT)): boolean {
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

/** The structure rules (docs/structure.md) on the repository's files, in this process. */
export function structureCheck(io: MainIo, deps: ScanDeps = systemScanDeps(REPO_ROOT)): boolean {
  const tree = repoTree(deps);
  const violations = checkStructure(tree);
  if (violations.length > 0) {
    io.stderr(formatViolations(violations));
    return false;
  }
  io.stdout(`structure ok in ${tree.paths.length} files\n`);
  return true;
}

/**
 * The steps of `mwc check` for the given workspace package directories, in order. The two in-process
 * steps share `scan`, so one run lists the repository's files once and reads each file once.
 */
export function checkSteps(
  flags: ReadonlySet<string>,
  packageDirs: readonly string[],
  lane: FullLane = NO_DOCKER,
  scan: ScanDeps = cachedScanDeps(systemScanDeps(REPO_ROOT)),
): CheckStep[] {
  const steps: CheckStep[] = [
    { label: 'biome', command: 'pnpm', args: ['exec', 'biome', 'check', '.'] },
    {
      label: 'banned names',
      command: process.execPath,
      args: ['packages/cli/src/mwc.ts', 'banned'],
      run: (io) => bannedNames(io, scan),
    },
    {
      label: 'structure',
      command: process.execPath,
      args: ['packages/cli/src/mwc.ts', 'structure'],
      run: (io) => structureCheck(io, scan),
    },
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
  return flags.has('full') ? [...steps, ...fullSteps(flags, packageDirs, lane)] : steps;
}

/** Where workspace packages live (pnpm-workspace.yaml), in typecheck order; a missing group is fine. */
export const WORKSPACE_GROUPS: readonly string[] = ['packages', 'connectors', 'apps'];

/** Workspace package directories (relative to the repo root) that have a tsconfig.json. */
export function workspacePackages(root: string = REPO_ROOT): string[] {
  const dirs: string[] = [];
  for (const group of WORKSPACE_GROUPS) {
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
    cwd: join(REPO_ROOT, step.cwd ?? ''),
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
      cwd: REPO_ROOT,
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
  /** The files the in-process steps and the closing warnings read: listed once, each read once. */
  readonly scan: ScanDeps;
  /** The last coverage run's summary (json-summary), or undefined when there is none. */
  coverage(): string | undefined;
}

/**
 * `mwc check`: every step runs even after a failure, so one run shows every problem; then the structure
 * warnings in a few lines, which never change the exit code.
 */
export function runCheck(flags: ReadonlySet<string>, io: MainIo, deps?: CheckDeps): number {
  const {
    packageDirs,
    runStep,
    lane: detect,
    scan,
    coverage,
  } = deps ?? {
    packageDirs: workspacePackages(),
    runStep: spawnStep,
    lane: detectLane,
    scan: cachedScanDeps(systemScanDeps(REPO_ROOT)),
    coverage: coverageReader(),
  };
  let lane = NO_DOCKER;
  if (flags.has('full')) {
    lane = detect?.() ?? NO_DOCKER;
    if (!lane.docker) io.stdout('\n(--full: Docker is not available, so the Postgres lane is skipped)\n');
  }
  const failed: string[] = [];
  for (const step of checkSteps(flags, packageDirs, lane, scan)) {
    io.stdout(`\n▶ ${step.label}\n`);
    if (!runStep(step, io)) failed.push(step.label);
  }
  // --fast runs the tests without coverage, so its summary leaves coverage out instead of showing an older run.
  io.stdout(`\n${formatSummary(warningsOf(scan, flags.has('fast') ? undefined : coverage()).warnings)}`);
  if (failed.length > 0) {
    io.stderr(`\n✗ mwc check failed: ${failed.join(', ')}\n`);
    return 1;
  }
  io.stdout('\n✓ mwc check passed\n');
  return 0;
}

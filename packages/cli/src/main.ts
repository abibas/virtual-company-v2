/**
 * mwc command dispatch. `mwc.ts` is the executable entry; everything it does goes through
 * `main()` so the commands can be tested without spawning a process.
 *
 *   mwc check [--fast] [--full]      lint, typecheck every package, run the tests (with coverage unless --fast)
 *   mwc ports [--slot N] [--path P]  print the port map, or the ports of a worktree slot
 *   mwc help
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PORTS, SLOT_COUNT, slotFromPath, slotPorts } from '@mwc/shared/ports';
import { parseArgs } from './args.ts';

export interface MainIo {
  stdout(s: string): void;
  stderr(s: string): void;
  /** The directory relative paths are resolved against when `env.INIT_CWD` is not set. */
  readonly cwd: string;
  /** pnpm runs scripts from the package root and passes the caller's directory as `INIT_CWD`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const repoRoot = resolve(import.meta.dirname, '../../..');

/** One step of `mwc check`: a label and the process to run from the repo root. */
export interface CheckStep {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** The steps of `mwc check` for the given workspace package directories, in order. */
export function checkSteps(flags: ReadonlySet<string>, packageDirs: readonly string[]): CheckStep[] {
  const steps: CheckStep[] = [{ label: 'biome', command: 'pnpm', args: ['exec', 'biome', 'check', '.'] }];
  for (const dir of packageDirs) {
    steps.push({ label: `typecheck ${dir}`, command: 'pnpm', args: ['exec', 'tsc', '--noEmit', '-p', dir] });
  }
  steps.push({
    label: 'tests',
    command: 'pnpm',
    args: ['exec', 'vitest', 'run', ...(flags.has('fast') ? [] : ['--coverage'])],
  });
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

function spawnStep(step: CheckStep, io: MainIo): boolean {
  const result = spawnSync(step.command, step.args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) {
    io.stderr(`${step.label}: ${result.error.message}\n`);
    return false;
  }
  return result.status === 0;
}

export interface CheckDeps {
  readonly packageDirs: readonly string[];
  /** Runs one step with inherited stdio; true when it passed. */
  runStep(step: CheckStep, io: MainIo): boolean;
}

/** `mwc check`: every step runs even after a failure, so one run shows every problem. */
export function runCheck(flags: ReadonlySet<string>, io: MainIo, deps?: CheckDeps): number {
  const { packageDirs, runStep } = deps ?? { packageDirs: workspacePackages(), runStep: spawnStep };
  if (flags.has('full')) {
    io.stdout('\n(--full: the Postgres and e2e lanes arrive with S0.5 and S0.6)\n');
  }
  const failed: string[] = [];
  for (const step of checkSteps(flags, packageDirs)) {
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

const HELP = [
  'mwc commands:',
  '  check [--fast] [--full]        lint, typecheck, test (coverage unless --fast)',
  '  ports [--slot N] [--path P]    the port map or a worktree slot',
  '  help',
  '',
].join('\n');

/** Run one `mwc` command; returns the process exit code (0 ok, 1 failed, 2 usage error). */
export function main(argv: readonly string[], io: MainIo): number {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'check':
      return runCheck(args.flags, io);
    case 'ports':
      return ports(args.flags, args.options, io);
    case undefined:
    case 'help':
      io.stdout(HELP);
      return 0;
    default:
      io.stderr(`unknown command: ${args.command}\n${HELP}`);
      return 2;
  }
}

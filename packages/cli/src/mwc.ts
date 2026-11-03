/**
 * mwc: the developer and operator CLI. Run with `pnpm mwc <command>` from the repo root.
 *
 *   mwc check [--fast] [--full]   lint, typecheck every package, run the tests (with coverage unless --fast)
 *   mwc ports [--slot N] [--path P]  print the port map, or the ports of a worktree slot
 *   mwc help
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PORTS, slotFromPath, slotPorts } from '@mwc/shared/ports';
import { parseArgs } from './args.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');

function run(label: string, command: string, args: readonly string[]): boolean {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`${label}: ${result.error.message}\n`);
    return false;
  }
  return result.status === 0;
}

function workspacePackages(): string[] {
  const dirs: string[] = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir).sort()) {
      const dir = join(group, name);
      if (existsSync(join(repoRoot, dir, 'tsconfig.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

function check(flags: ReadonlySet<string>): number {
  const fast = flags.has('fast');
  const steps: Array<[string, string, string[]]> = [['biome', 'pnpm', ['exec', 'biome', 'check', '.']]];
  for (const dir of workspacePackages()) {
    steps.push([`typecheck ${dir}`, 'pnpm', ['exec', 'tsc', '--noEmit', '-p', dir]]);
  }
  steps.push(['tests', 'pnpm', ['exec', 'vitest', 'run', ...(fast ? [] : ['--coverage'])]]);
  if (flags.has('full')) {
    process.stdout.write('\n(--full: the Postgres and e2e lanes arrive with S0.5 and S0.6)\n');
  }

  const failed: string[] = [];
  for (const [label, command, args] of steps) {
    if (!run(label, command, args)) failed.push(label);
  }
  if (failed.length > 0) {
    process.stderr.write(`\n✗ mwc check failed: ${failed.join(', ')}\n`);
    return 1;
  }
  process.stdout.write('\n✓ mwc check passed\n');
  return 0;
}

function ports(options: Readonly<Record<string, string>>): number {
  if (options.slot !== undefined || options.path !== undefined) {
    const slot =
      options.slot !== undefined ? Number(options.slot) : slotFromPath(resolve(options.path ?? '.'));
    const p = slotPorts(slot);
    process.stdout.write(`slot ${p.slot}: api ${p.api}, web ${p.web}, postgres ${p.postgres}\n`);
    return 0;
  }
  process.stdout.write(
    `${JSON.stringify(PORTS, null, 2)}\nworktree slots: 9960–9989 (mwc ports --slot N | --path P)\n`,
  );
  return 0;
}

function help(): number {
  process.stdout.write(
    [
      'mwc commands:',
      '  check [--fast] [--full]        lint, typecheck, test (coverage unless --fast)',
      '  ports [--slot N] [--path P]    the port map or a worktree slot',
      '  help',
      '',
    ].join('\n'),
  );
  return 0;
}

const args = parseArgs(process.argv.slice(2));
switch (args.command) {
  case 'check':
    process.exit(check(args.flags));
    break;
  case 'ports':
    process.exit(ports(args.options));
    break;
  case undefined:
  case 'help':
    process.exit(help());
    break;
  default:
    process.stderr.write(`unknown command: ${args.command}\n`);
    help();
    process.exit(2);
}

/**
 * mwc command dispatch. `mwc.ts` is the executable entry; everything it does goes through
 * `main()` so the commands can be tested without spawning a process.
 *
 *   mwc check [--fast] [--full]      lint, banned names, structure (docs/structure.md), typecheck every
 *                                    package, db drift (migrations and the schema diagram), the tests
 *                                    (with coverage unless --fast); --full adds the db and server tests
 *                                    on the dev Postgres (when Docker is available) and the web build
 *   mwc dev [--down]                 dev Postgres + migrations + API (9950) + web (9951); --down stops Postgres
 *   mwc ports [--slot N] [--path P]  print the port map, or the ports of a worktree slot
 *   mwc banned [--message FILE]      fail on a banned name (banned.ts) in the repository's files, or in
 *                                    a commit message file (the commit-msg hook)
 *   mwc structure                    fail on a broken layout rule (structure/rules.ts)
 *   mwc help
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PORTS, SLOT_COUNT, slotFromPath, slotPorts } from '@mwc/shared/ports';
import { parseArgs } from './args.ts';
import { commitMessageText, formatHits, type ScanDeps, scanText } from './banned.ts';
import { bannedNames, runCheck, structureCheck } from './check.ts';
import { runDev, systemDevDeps } from './dev.ts';
import { type MainIo, REPO_ROOT } from './io.ts';

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
  '  check [--fast] [--full]        lint, banned names, structure, typecheck, db drift, test (coverage',
  '                                 unless --fast); --full: tests on Postgres, web build',
  '  dev [--down]                   Postgres, migrations, API on 9950 and web on 9951; --down stops Postgres',
  '  ports [--slot N] [--path P]    the port map or a worktree slot',
  '  banned [--message FILE]        banned names in the repository, or in a commit message file',
  '  structure                      the layout rules of docs/structure.md on the repository',
  '  help',
  '',
].join('\n');

export interface MainDeps {
  /** `mwc dev` with its processes; the real ones by default. */
  dev?(flags: ReadonlySet<string>, io: MainIo): Promise<number>;
  /** The files `mwc banned` and `mwc structure` scan; git's by default. */
  scan?: ScanDeps;
}

const systemDev = (flags: ReadonlySet<string>, io: MainIo) =>
  runDev(flags, io, systemDevDeps(REPO_ROOT, io.env ?? process.env));

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
    case 'structure':
      return structureCheck(io, deps.scan) ? 0 : 1;
    case undefined:
    case 'help':
      io.stdout(HELP);
      return 0;
    default:
      io.stderr(`unknown command: ${args.command}\n${HELP}`);
      return 2;
  }
}

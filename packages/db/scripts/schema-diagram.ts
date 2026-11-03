/**
 * Schema diagram: renders `docs/schema.md` (a Mermaid ER diagram and a section per table, see
 * src/diagram.ts) from the Drizzle schema, or checks that the committed file is current.
 *
 *   node scripts/schema-diagram.ts --write   pnpm --filter @mwc/db diagram
 *   node scripts/schema-diagram.ts --check   pnpm --filter @mwc/db check:diagram (also in mwc check's db drift)
 *
 * Exit 0 when written or current, 1 on drift, 2 on a usage error. Runs on Node's own TypeScript
 * support (no tsx process).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { migrationSummary, renderSchemaDiagram } from '../src/diagram.ts';
import * as schema from '../src/schema/index.ts';

const packageDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageDir, '../..');

/** `docs/schema.md` at the repo root. */
export const SCHEMA_DOC = join(repoRoot, 'docs/schema.md');
const JOURNAL = join(packageDir, 'migrations/meta/_journal.json');

export interface DiagramIo {
  stdout(s: string): void;
  stderr(s: string): void;
}

const processIo: DiagramIo = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const shown = (path: string) => relative(repoRoot, path) || path;

/** The `docs/schema.md` the current schema and migrations journal give. */
export function renderSchemaDoc(): string {
  return renderSchemaDiagram(schema, migrationSummary(JSON.parse(readFileSync(JOURNAL, 'utf8'))));
}

/** 0 when the file at `path` equals `expected` (line endings aside), else 1 with a short message. */
export function checkDiagram(
  path = SCHEMA_DOC,
  io: DiagramIo = processIo,
  expected = renderSchemaDoc(),
): number {
  const current = existsSync(path) ? readFileSync(path, 'utf8').replaceAll('\r\n', '\n') : undefined;
  if (current === expected) {
    io.stdout(`schema diagram is current (${shown(path)})\n`);
    return 0;
  }
  let why = 'is missing';
  if (current !== undefined) {
    const have = current.split('\n');
    const want = expected.split('\n');
    const line = want.findIndex((text, i) => have[i] !== text) + 1 || want.length + 1;
    why = `does not match the schema (first difference at line ${line})`;
  }
  io.stderr(`check-diagram: ${shown(path)} ${why}.\nRun \`pnpm --filter @mwc/db diagram\` and commit it.\n`);
  return 1;
}

/** Writes `content` to `path`; returns 0. */
export function writeDiagram(
  path = SCHEMA_DOC,
  io: DiagramIo = processIo,
  content = renderSchemaDoc(),
): number {
  writeFileSync(path, content);
  io.stdout(`wrote ${shown(path)}\n`);
  return 0;
}

/** `--write` or `--check`; 2 for anything else. */
export function runDiagram(argv: readonly string[], io: DiagramIo = processIo, path = SCHEMA_DOC): number {
  if (argv.length === 1 && argv[0] === '--write') return writeDiagram(path, io);
  if (argv.length === 1 && argv[0] === '--check') return checkDiagram(path, io);
  io.stderr('usage: node scripts/schema-diagram.ts --write | --check\n');
  return 2;
}

if (import.meta.main) process.exitCode = runDiagram(process.argv.slice(2));

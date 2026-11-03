/**
 * Migrations drift check: fails when the Drizzle schema (src/schema) and the committed migrations
 * (migrations/) disagree, that is when `drizzle-kit generate` would write a new migration.
 *
 * It copies migrations/ to a temp folder, runs `drizzle-kit generate` once with a temp config whose
 * `out` is that copy, and compares the copy with the original. The committed files are never
 * touched. Exit 0 when they agree, 1 on drift (the would-be SQL is printed), 2 when drizzle-kit fails.
 *
 * Runs on Node's own TypeScript support: `node scripts/check-migrations.ts` (no tsx process).
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
const migrationsDir = join(packageDir, 'migrations');
const drizzleKit = join(packageDir, 'node_modules/drizzle-kit/bin.cjs');

/** Every file under `dir`, as relative path → contents. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isFile()) files.set(entry, readFileSync(path, 'utf8'));
  }
  return files;
}

function main(): number {
  if (!existsSync(drizzleKit)) {
    process.stderr.write(
      `check-migrations: drizzle-kit is not installed (${drizzleKit}); run pnpm install\n`,
    );
    return 2;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'mwc-migrations-'));
  try {
    const out = join(tmp, 'migrations');
    if (existsSync(migrationsDir)) cpSync(migrationsDir, out, { recursive: true });
    const config = join(tmp, 'drizzle.config.ts');
    writeFileSync(
      config,
      [
        `import base from ${JSON.stringify(join(packageDir, 'drizzle.config.ts'))};`,
        // drizzle-kit reads `out` relative to its cwd (it prefixes './'), so an absolute path breaks.
        `export default { ...base, out: ${JSON.stringify(relative(packageDir, out))} };`,
        '',
      ].join('\n'),
    );

    // cwd is the package so the schema path in drizzle.config.ts resolves as it does for `generate`.
    // stdin is closed: if drizzle-kit wants to ask (a rename), it fails instead of waiting.
    const result = spawnSync(process.execPath, [drizzleKit, 'generate', '--config', config], {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const before = snapshot(migrationsDir);
    const after = snapshot(out);
    const added = [...after.keys()].filter((file) => !before.has(file));
    const changed = [...after.keys()].filter(
      (file) => before.has(file) && before.get(file) !== after.get(file),
    );
    // drizzle-kit 0.31 exits 0 even when it throws, so success must be visible: either it says there is
    // nothing to do, or it wrote a migration.
    const noChanges = output.includes('No schema changes');
    if (result.error || result.status !== 0 || (!noChanges && added.length === 0)) {
      const why =
        result.error?.message ?? (result.status === 0 ? 'no result reported' : `exit ${result.status}`);
      process.stderr.write(
        `check-migrations: drizzle-kit generate failed (${why}).\n` +
          'If it needs an answer (a rename), run `pnpm --filter @mwc/db generate` yourself.\n' +
          `${output}\n`,
      );
      return 2;
    }

    if (added.length === 0 && changed.length === 0) {
      process.stdout.write(`migrations match the schema (${before.size} files in packages/db/migrations)\n`);
      return 0;
    }

    process.stderr.write(
      'check-migrations: the schema and packages/db/migrations disagree.\n' +
        'Run `pnpm --filter @mwc/db generate --name <change>`, review the SQL and commit it.\n',
    );
    for (const file of added) process.stderr.write(`  new: migrations/${file}\n`);
    for (const file of changed) process.stderr.write(`  changed: migrations/${file}\n`);
    for (const file of added.filter((name) => name.endsWith('.sql'))) {
      process.stderr.write(`\n--- would-be migrations/${file}\n${after.get(file)}\n`);
    }
    return 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

process.exitCode = main();

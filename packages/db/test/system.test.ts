import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { companies } from '../src/schema/index.ts';
import * as system from '../src/system.ts';
import type { TestDb } from '../src/testing.ts';
import { insertCompany, migratedTestDb } from './fixtures/rows.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

describe('@mwc/db/system', () => {
  let testDb: TestDb;
  beforeAll(async () => {
    testDb = await migratedTestDb();
  });
  afterAll(() => testDb.close());

  it('hands out the raw Drizzle database behind a handle, unscoped', async () => {
    const acme = await insertCompany(testDb.handle);
    const globex = await insertCompany(testDb.handle);
    expect(system.rawHandle(testDb.handle)).toBe(testDb.handle);
    const ids = (await system.rawDb(testDb.handle).select().from(companies)).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([acme.id, globex.id]));
    const [row] = await system.queryRows<{ n: number }>(
      testDb.handle,
      sql`select count(*)::int as n from companies`,
    );
    expect(row?.n).toBeGreaterThanOrEqual(2);
  });

  it('offers what the platform needs to open and migrate a database', () => {
    expect(typeof system.createDb).toBe('function');
    expect(typeof system.migrateToLatest).toBe('function');
    expect(system.MIGRATIONS_FOLDER).toMatch(/packages\/db\/migrations$/);
  });
});

/** Biome's own binary for this machine, or its Node launcher when the platform package is elsewhere. */
function biome(): { command: string; prefix: string[] } {
  const require = createRequire(join(ROOT, 'node_modules/@biomejs/biome/package.json'));
  try {
    return { command: require.resolve(`@biomejs/cli-${process.platform}-${process.arch}/biome`), prefix: [] };
  } catch {
    return {
      command: process.execPath,
      prefix: [join(dirname(require.resolve('@biomejs/biome/package.json')), 'bin/biome')],
    };
  }
}

describe('the import rule (biome.json): server modules never import the raw database', () => {
  // The repository's own overrides, on a scratch tree: a module, the identity store and the platform each
  // import @mwc/db/system, and a module imports @mwc/db. One Biome run lints them all.
  const probes: Record<string, string> = {
    'apps/server/src/modules/members/service.ts':
      "import { rawDb } from '@mwc/db/system';\n\nexport const x = rawDb;\n",
    'apps/server/src/modules/members/repo/list.ts':
      "import type { RawDb } from '@mwc/db/system';\n\nexport type X = RawDb;\n",
    'apps/server/src/modules/companies/repo.ts':
      "import { createPgliteDb } from '@mwc/db/pglite';\n\nexport const x = createPgliteDb;\n",
    'apps/server/src/modules/members/repo.ts':
      "import { tenant } from '@mwc/db';\n\nexport const x = tenant;\n",
    'apps/server/src/modules/identity/repo.ts':
      "import { rawDb } from '@mwc/db/system';\n\nexport const x = rawDb;\n",
    'apps/server/src/modules/identity/repo/users.ts':
      "import { rawDb } from '@mwc/db/system';\n\nexport const x = rawDb;\n",
    'apps/server/src/platform/jobs/outbox.ts':
      "import { rawDb } from '@mwc/db/system';\n\nexport const x = rawDb;\n",
  };
  let scratch: string;
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'mwc-biome-'));
    const config = JSON.parse(readFileSync(join(ROOT, 'biome.json'), 'utf8')) as Record<string, unknown>;
    // The scratch tree is not a git checkout and has no node_modules for the schema.
    delete config.$schema;
    config.vcs = { enabled: false };
    writeFileSync(join(scratch, 'biome.json'), JSON.stringify(config));
    for (const [path, text] of Object.entries(probes)) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), text);
    }
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('fires in a module, and only there: not in the identity store or the platform', () => {
    const { command, prefix } = biome();
    const run = spawnSync(command, [...prefix, 'lint', '--reporter=json', '.'], {
      cwd: scratch,
      encoding: 'utf8',
    });
    const report = JSON.parse(run.stdout) as {
      diagnostics: { category: string; message: string; location: { path: string } }[];
    };
    const restricted = report.diagnostics.filter((d) => d.category === 'lint/style/noRestrictedImports');
    expect(restricted.map((d) => d.location.path).sort()).toEqual([
      'apps/server/src/modules/companies/repo.ts',
      'apps/server/src/modules/members/repo/list.ts',
      'apps/server/src/modules/members/service.ts',
    ]);
    expect(restricted[0]?.message).toContain('tenant(db, companyId)');
    expect(report.diagnostics).toHaveLength(restricted.length);
    expect(run.status).toBe(1);
  });
});

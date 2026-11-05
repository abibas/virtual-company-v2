/**
 * A database left at an older migration: the migrations up to a tag, applied from a temporary folder that holds only
 * those files and the journal cut there (as the repository was when that one was the last). `migrateToLatest(handle)`
 * then applies the rest, so a test can seed rows in the older schema and check what a later migration makes of them.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DbHandle, MIGRATIONS_FOLDER, migrateToLatest } from '../../src/migrate.ts';

interface Journal {
  readonly entries: readonly { readonly tag: string }[];
}

/** The repository's own journal, as `drizzle-kit generate` wrote it. */
export const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
) as Journal;

/** Applies the migrations up to and including `tag`, and none after it. */
export async function migrateUpTo(handle: DbHandle, tag: string): Promise<void> {
  const last = journal.entries.findIndex((entry) => entry.tag === tag);
  if (last < 0) throw new Error(`no migration ${tag} in the journal`);
  const entries = journal.entries.slice(0, last + 1);
  const folder = mkdtempSync(join(tmpdir(), `mwc-${tag}-`));
  try {
    mkdirSync(join(folder, 'meta'));
    for (const { tag: file } of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${file}.sql`), join(folder, `${file}.sql`));
    }
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    await migrateToLatest(handle, { migrationsFolder: folder });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

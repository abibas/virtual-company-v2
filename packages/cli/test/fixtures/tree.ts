import type { ScanDeps } from '../../src/banned.ts';
import { type RepoTree, repoTree } from '../../src/structure/tree.ts';
import { skillDoc, structureDoc } from './docs.ts';

/** File contents by path: a string, raw bytes, or undefined for a file listed but gone. */
export type Files = Readonly<Record<string, string | Uint8Array | undefined>>;

/** A file listing over an in-memory map, counting how often it is listed and each file read. */
export function scanOf(files: Files) {
  const reads = new Map<string, number>();
  let listings = 0;
  const deps: ScanDeps = {
    listFiles: () => {
      listings++;
      return Object.keys(files);
    },
    readFile: (path) => {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      const content = files[path];
      return typeof content === 'string' ? Buffer.from(content) : content;
    },
  };
  return { deps, reads, listings: () => listings };
}

export function treeOf(files: Files): RepoTree {
  return repoTree(scanOf(files).deps);
}

/** `n` lines of code. */
export const lines = (n: number) => 'const x = 1;\n'.repeat(n);

/** A small repository that keeps every structure rule (its docs state the rules, at any length). */
export const CLEAN: Files = {
  '.claude/skills/keep-structure/SKILL.md': skillDoc(),
  '.githooks/pre-push': 'exec pnpm mwc check --fast\n',
  '.vscode/settings.json': '{}\n',
  'CLAUDE.md': '# Rules\n',
  'README.md': '# Readme\n',
  'package.json': '{ "name": "root" }\n',
  'pnpm-lock.yaml': lines(2000),
  'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/*\n  - connectors/*\n',
  'docs/schema.md': lines(900),
  'docs/structure.md': structureDoc() + lines(800),
  'deploy/compose.yml': 'services: {}\n',
  'packages/db/package.json': '{ "name": "@mwc/db" }\n',
  'packages/db/tsconfig.json': '{}\n',
  'packages/db/vitest.config.ts': 'export default {};\n',
  'packages/db/drizzle.config.ts': 'export default {};\n',
  'packages/db/migrations/0000_init.sql': lines(1200),
  'packages/db/migrations/meta/0000_snapshot.json': lines(1200),
  'packages/db/src/schema/users.ts': lines(10),
  'packages/db/test/schema.test.ts': lines(10),
  'packages/db/test/fixtures/rows.ts': lines(10),
  'packages/db/scripts/migrate.ts': lines(10),
  'apps/server/package.json': '{ "name": "@mwc/server" }\n',
  'apps/server/tsconfig.json': '{}\n',
  'apps/server/vitest.config.ts': 'export default {};\n',
  'apps/server/README.md': '# Server\n',
  'apps/server/src/main.ts': lines(3),
  'apps/server/src/app.ts': "import { healthRoutes } from './modules/health/index.ts';\n",
  'apps/server/src/modules/health/index.ts': "export { healthRoutes } from './routes.ts';\n",
  'apps/server/src/modules/health/routes.ts': "import { healthService } from './service.ts';\n",
  'apps/server/src/modules/health/service.ts': "import { readJournal } from '@mwc/db';\n",
  'apps/server/src/modules/health/schemas.ts': lines(5),
  'apps/server/src/modules/members/service/invite.ts': "import { findMember } from '../repo.ts';\n",
  'apps/server/src/modules/members/repo.ts': lines(5),
  'apps/server/test/modules/health/routes.test.ts': lines(500),
  'apps/web/package.json': '{ "name": "@mwc/web" }\n',
  'apps/web/tsconfig.json': '{}\n',
  'apps/web/index.html': '<!doctype html>\n',
  'apps/web/vite.config.ts': 'export default {};\n',
  'apps/web/src/main.tsx': lines(12),
  'connectors/identity-clerk/package.json': '{ "name": "@mwc/identity-clerk" }\n',
  'connectors/identity-clerk/tsconfig.json': '{}\n',
  'connectors/identity-clerk/vitest.config.ts': 'export default {};\n',
  'connectors/identity-clerk/src/provider.ts': lines(300),
  'connectors/identity-clerk/test/provider.test.ts': lines(20),
  'docs/layout.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
};

/** CLEAN with some files added, replaced or (undefined) removed. */
export function cleanWith(changes: Files): RepoTree {
  const files: Record<string, string | Uint8Array | undefined> = { ...CLEAN };
  for (const [path, content] of Object.entries(changes)) {
    if (content === undefined) delete files[path];
    else files[path] = content;
  }
  return treeOf(files);
}

import { describe, expect, it } from 'vitest';
import { checkModules, connectorNames, importsOf } from '../../src/structure/modules.ts';
import { STRUCTURE_RULES } from '../../src/structure/rules.ts';
import { CLEAN, cleanWith, treeOf } from '../fixtures/tree.ts';

const M = 'apps/server/src/modules';

describe('checkModules', () => {
  it('passes a clean tree: role files, a role folder, its own repo, another module’s index', () => {
    const tree = cleanWith({
      [`${M}/members/routes.ts`]:
        "import { invite } from './service/invite.ts';\nimport { healthRoutes } from '../health/index.ts';\n",
      [`${M}/members/rules.ts`]: '',
    });
    expect(checkModules(tree, STRUCTURE_RULES)).toEqual([]);
    expect(checkModules(treeOf(CLEAN), STRUCTURE_RULES)).toEqual([]);
  });

  it('refuses a file directly in modules/, an unknown file in a module and an unknown or index folder', () => {
    const found = checkModules(
      cleanWith({
        [`${M}/shared.ts`]: '',
        [`${M}/members/helpers.ts`]: '',
        [`${M}/members/utils/date.ts`]: '',
        [`${M}/members/index/a.ts`]: '',
        [`${M}/members/README.md`]: '',
      }),
      STRUCTURE_RULES,
    );
    expect(found.map((v) => v.path)).toEqual([
      `${M}/members/README.md`,
      `${M}/members/helpers.ts`,
      `${M}/members/index/a.ts`,
      `${M}/members/utils/date.ts`,
      `${M}/shared.ts`,
    ]);
    expect(found[1]?.message).toBe(
      'a module has only routes.ts, service.ts, repo.ts, schemas.ts, rules.ts, index.ts (or a same-named folder, e.g. service/)',
    );
    expect(found[4]?.message).toBe('apps/server/src/modules/ holds one folder per business area, no files');
  });

  it("refuses an import of another module's repo, file or folder, with its line", () => {
    const found = checkModules(
      cleanWith({
        [`${M}/health/service.ts`]: [
          "import { readJournal } from '@mwc/db';",
          "import { findMember } from '../members/repo.ts';",
          'import {',
          '  listMembers,',
          "} from '../members/repo/list.ts';",
          "const lazy = () => import('../members/service/invite.ts');",
        ].join('\n'),
      }),
      STRUCTURE_RULES,
    );
    expect(found).toEqual([
      {
        path: `${M}/health/service.ts`,
        line: 2,
        rule: 'modules',
        message: `imports another module's repo (${M}/members/repo.ts): call its service instead`,
      },
      {
        path: `${M}/health/service.ts`,
        line: 5,
        rule: 'modules',
        message: `imports another module's repo (${M}/members/repo): call its service instead`,
      },
    ]);
  });

  it('refuses a connector import in a module; app.ts may wire it', () => {
    const found = checkModules(
      cleanWith({
        'apps/server/src/app.ts': "import { ClerkProvider } from '@mwc/identity-clerk';\n",
        [`${M}/members/service/invite.ts`]: "import type { ClerkProvider } from '@mwc/identity-clerk';\n",
      }),
      STRUCTURE_RULES,
    );
    expect(found).toEqual([
      {
        path: `${M}/members/service/invite.ts`,
        line: 1,
        rule: 'modules',
        message:
          'imports the connector @mwc/identity-clerk: modules use its port (packages/*-core); wire the connector in app.ts',
      },
    ]);
  });
});

describe('helpers', () => {
  it('finds static, dynamic, side-effect and re-export specifiers with their lines', () => {
    const text = [
      "import a from 'a';",
      "export { b } from './b.ts';",
      "import './side.css';",
      "await import('./lazy.ts');",
      "const s = 'from nowhere';",
    ].join('\n');
    expect(importsOf(text)).toEqual([
      { line: 1, specifier: 'a' },
      { line: 2, specifier: './b.ts' },
      { line: 3, specifier: './side.css' },
      { line: 4, specifier: './lazy.ts' },
    ]);
  });

  it('reads the connector package names, skipping broken or nameless manifests', () => {
    const tree = treeOf({
      'connectors/jira/package.json': '{ "name": "@mwc/jira" }',
      'connectors/broken/package.json': '{ name',
      'connectors/nameless/package.json': '{}',
      'connectors/jira/src/package.json': '{ "name": "@mwc/nested" }',
      'packages/db/package.json': '{ "name": "@mwc/db" }',
    });
    expect([...connectorNames(tree)]).toEqual(['@mwc/jira']);
  });
});

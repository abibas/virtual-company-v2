import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDiagram, type DiagramIo, renderSchemaDoc, runDiagram } from '../../scripts/schema-diagram.ts';
import { migrationSummary, renderSchemaDiagram } from '../../src/diagram/page.ts';
import * as schema from '../../src/schema/index.ts';
import { expectPlausibleMermaid, journal, mermaidLines, RELATIONSHIP } from '../fixtures/diagram.ts';

describe('renderSchemaDiagram on the real schema', () => {
  const doc = renderSchemaDiagram(schema, migrationSummary(journal));
  const lines = mermaidLines(doc);
  const tables = Object.values(schema).map((table) => getTableConfig(table));

  it('draws every table as an entity, sorted by name', () => {
    const entities = lines.filter((line) => line.endsWith(' {')).map((line) => line.trim().slice(0, -2));
    expect(entities).toEqual(tables.map((table) => table.name).sort());
    expect(entities).toHaveLength(37);
    expect(entities.slice(0, 4)).toEqual(['access_profiles', 'agent_icons', 'agent_placements', 'agents']);
  });

  it('lists every column of a table in declaration order', () => {
    for (const table of tables) {
      const start = lines.indexOf(`  ${table.name} {`);
      const names = lines
        .slice(start + 1, start + 1 + table.columns.length)
        .map((line) => line.trim().split(' ')[1]);
      expect(names).toEqual(table.columns.map((column) => column.name));
      expect(lines[start + 1 + table.columns.length]).toBe('  }');
    }
  });

  it('draws every foreign key as a relationship from the child, labelled with its column', () => {
    const relationships = lines.filter((line) => RELATIONSHIP.test(line));
    expect(relationships).toHaveLength(tables.reduce((n, table) => n + table.foreignKeys.length, 0));
    // Nullable: optional parent (o|); required: one parent (||); unique: one child (|o); tenant keys: two columns.
    expect(relationships).toContain('  companies }o--o| users : "created_by_user_id"');
    expect(relationships).toContain('  api_keys }o--|| principals : "company_id, principal_id"');
    expect(relationships).toContain('  memberships |o--|| principals : "company_id, principal_id"');
  });

  it('marks primary, foreign and unique keys and says null / default', () => {
    expect(lines).toContain('    uuid id PK "not null, default newId() (app-side)"');
    expect(lines).toContain('    bigserial id PK "not null, default auto-increment"');
    expect(lines).toContain('    text primary_email "not null"');
    expect(lines).toContain('    text identity_org_id UK "nullable"');
    expect(lines).toContain('    uuid company_id FK "nullable"');
    expect(lines).toContain('    jsonb settings "not null, default \'{}\'"');
    expect(lines).toContain('    timestamptz created_at "not null, default now()"');
  });

  it('puts the values of an enum-like CHECK in the comment', () => {
    expect(lines).toContain('    text status "not null, default \'active\', active|deactivated"');
    expect(lines).toContain(
      '    text status "not null, default \'provisioning\', provisioning|active|suspended|deleted"',
    );
    expect(lines).toContain('    text actor_kind "not null, user|agent|system|identity"');
  });

  it('is plausible Mermaid', () => {
    expectPlausibleMermaid(lines);
  });

  it('is deterministic and does not depend on the export order', () => {
    const reversed = Object.fromEntries(Object.entries(schema).reverse());
    expect(renderSchemaDiagram(reversed, migrationSummary(journal))).toBe(doc);
    expect(renderSchemaDiagram(schema, migrationSummary(journal))).toBe(doc);
    expect(doc.endsWith('\n')).toBe(true);
    expect(doc.endsWith('\n\n')).toBe(false);
    expect(doc).not.toContain('\r');
  });

  it('says it is generated, by what, and from which migrations', () => {
    expect(doc.startsWith('# Database schema\n')).toBe(true);
    expect(doc).toContain('Generated from `packages/db/src/schema/` by `pnpm --filter @mwc/db diagram`');
    expect(doc).toContain('Do not edit by\n> hand');
    expect(doc).toContain(
      `Tables: 37. Migrations: ${journal.entries.length}, the last is \`${journal.entries.at(-1)?.tag}\`.`,
    );
  });

  it('writes a readable section per table', () => {
    expect(doc).toContain('\n### `users`\n\n| Column | Type | Nullable | Default | Key | Allowed values |\n');
    expect(doc).toContain('| `primary_email` | `text` | no |  |  |  |');
    expect(doc).toContain("| `status` | `text` | no | `'active'` |  | `active`, `deactivated` |");
    expect(doc).toContain('| `created_at` | `timestamp with time zone` | no | `now()` |  |  |');
    expect(doc).toContain('  - `users_status_check`: `status` is one of `active`, `deactivated`');
    expect(doc).toContain(
      '  - `users_primary_email_lower_check`: `"primary_email" = lower("primary_email")`',
    );
    expect(doc).toContain('  - `user_identities_issuer_subject_unique` (`issuer`, `subject`)');
    expect(doc).toContain('  - `audit_log_entity_idx` on (`company_id`, `entity_type`, `entity_id`, `id`)\n');
    expect(doc).toContain(
      '  - `company_id` → `companies` (`id`), on delete no action (`audit_log_company_id_companies_id_fk`)',
    );
    expect(doc).toContain('| `bytes` | `bytea` | no |  |  |  |');
    expect(doc.match(/^### /gm)).toHaveLength(37);
  });
});

describe('scripts/schema-diagram.ts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mwc-diagram-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    const io: DiagramIo = { stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
    return { io, out: () => out.join(''), err: () => err.join('') };
  }

  it('renders the real schema with the real journal', () => {
    expect(renderSchemaDoc()).toBe(renderSchemaDiagram(schema, migrationSummary(journal)));
  });

  it('--write writes the file and --check then passes', () => {
    const path = join(dir, 'written.md');
    const write = capture();
    expect(runDiagram(['--write'], write.io, path)).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(renderSchemaDoc());
    expect(write.out()).toContain('wrote ');
    const check = capture();
    expect(runDiagram(['--check'], check.io, path)).toBe(0);
    expect(check.out()).toContain('schema diagram is current');
    expect(check.err()).toBe('');
  });

  it('--check fails on a missing or stale file and says what to run', () => {
    const missing = capture();
    expect(checkDiagram(join(dir, 'missing.md'), missing.io, 'a\n')).toBe(1);
    expect(missing.err()).toContain('missing.md is missing.');
    expect(missing.err()).toContain('Run `pnpm --filter @mwc/db diagram`');

    const path = join(dir, 'stale.md');
    writeFileSync(path, 'line 1\nline two\n');
    const stale = capture();
    expect(checkDiagram(path, stale.io, 'line 1\nline 2\n')).toBe(1);
    expect(stale.err()).toContain('does not match the schema (first difference at line 2)');

    writeFileSync(path, 'line 1\n');
    const longer = capture();
    expect(checkDiagram(path, longer.io, 'line 1\nline 2\n')).toBe(1);
    expect(longer.err()).toContain('(first difference at line 2)');

    writeFileSync(path, 'line 1\nline 2\nmore\n');
    const shorter = capture();
    expect(checkDiagram(path, shorter.io, 'line 1\nline 2\n')).toBe(1);
    expect(shorter.err()).toContain('(first difference at line 3)');
  });

  it('--check ignores CRLF line endings', () => {
    const path = join(dir, 'crlf.md');
    writeFileSync(path, 'a\r\nb\r\n');
    expect(checkDiagram(path, capture().io, 'a\nb\n')).toBe(0);
  });

  it('refuses anything but one of --write and --check', () => {
    for (const argv of [[], ['--write', '--check'], ['--bogus']]) {
      const c = capture();
      expect(runDiagram(argv, c.io, join(dir, 'never.md'))).toBe(2);
      expect(c.err()).toContain('usage: node scripts/schema-diagram.ts --write | --check');
    }
  });
});

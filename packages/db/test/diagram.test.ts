import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  getTableConfig,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDiagram, type DiagramIo, renderSchemaDoc, runDiagram } from '../scripts/schema-diagram.ts';
import { collectTables, describeTable, parseOneOf, sqlText, valueText } from '../src/diagram/describe.ts';
import { mermaidType, renderMermaid } from '../src/diagram/mermaid.ts';
import { migrationSummary, renderSchemaDiagram } from '../src/diagram.ts';
import { MIGRATIONS_FOLDER } from '../src/migrate.ts';
import { oneOf } from '../src/schema/columns.ts';
import * as schema from '../src/schema/index.ts';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ tag: string }>;
};

/** The lines of the Mermaid block of a rendered document. */
function mermaidLines(doc: string): string[] {
  const block = /```mermaid\n([\s\S]*?)\n```/.exec(doc)?.[1];
  if (block === undefined) throw new Error('no mermaid block');
  return block.split('\n');
}

const RELATIONSHIP = /^ {2}(\w+) (\}o|\|o)--(\|\||o\|) (\w+) : "([^"]+)"$/;
const ATTRIBUTE = /^ {4}[A-Za-z_][\w\-[\]()]* [A-Za-z_][\w-]*(?: (?:PK|FK|UK)(?:, (?:PK|FK|UK))*)? "[^"]*"$/;

/** Mermaid's erDiagram shape: entity blocks of attribute lines, braces balanced and never nested, then relationships. */
function expectPlausibleMermaid(lines: readonly string[]): void {
  expect(lines[0]).toBe('erDiagram');
  let open = false;
  for (const line of lines.slice(1)) {
    if (/^ {2}\w+ \{$/.test(line)) {
      expect(open).toBe(false);
      open = true;
    } else if (line === '  }') {
      expect(open).toBe(true);
      open = false;
    } else if (open) {
      expect(line).toMatch(ATTRIBUTE);
    } else {
      expect(line).toMatch(RELATIONSHIP);
    }
  }
  expect(open).toBe(false);
  // Relationship cardinalities use braces too (`}o`); the entity blocks' braces must pair up.
  const blocks = lines.filter((line) => !RELATIONSHIP.test(line)).join('\n');
  expect(blocks.split('{').length).toBe(blocks.split('}').length);
}

describe('renderSchemaDiagram on the real schema', () => {
  const doc = renderSchemaDiagram(schema, migrationSummary(journal));
  const lines = mermaidLines(doc);
  const tables = Object.values(schema).map((table) => getTableConfig(table));

  it('draws every table as an entity, sorted by name', () => {
    const entities = lines.filter((line) => line.endsWith(' {')).map((line) => line.trim().slice(0, -2));
    expect(entities).toEqual(tables.map((table) => table.name).sort());
    expect(entities).toHaveLength(13);
    expect(entities.slice(0, 4)).toEqual(['api_keys', 'audit_log', 'companies', 'company_logos']);
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
      `Tables: 13. Migrations: ${journal.entries.length}, the last is \`${journal.entries.at(-1)?.tag}\`.`,
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
    expect(doc.match(/^### /gm)).toHaveLength(13);
  });
});

// A synthetic schema for what the real one does not have yet: composite and table-level keys,
// one-to-one and self references, required foreign keys, unique indexes and the default kinds.
const parents = pgTable(
  'parents',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    code: varchar('code', { length: 8 }),
    amount: numeric('amount', { precision: 10, scale: 2 }).default('0'),
    ratio: doublePrecision('ratio').default(0.5),
    active: boolean('active').notNull().default(true),
    tags: text('tags').array().default(['a', 'b']),
    since: timestamp('since', { precision: 3, withTimezone: true }).default(new Date(0)),
    nothing: text('nothing').default(sql`null`),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    unique('parents_code_unique').on(t.code).nullsNotDistinct(),
    check('parents_amount_check', sql`${t.amount} > ${0}`),
  ],
);

const children = pgTable(
  'children',
  {
    id: serial('id').primaryKey(),
    companyId: uuid('company_id').notNull(),
    parentId: uuid('parent_id').notNull(),
    previousId: integer('previous_id').references((): AnyPgColumn => children.id),
    kind: text('kind').notNull().default("it's"),
    label: text('label').generatedAlwaysAs(sql`'x'`),
    touched: timestamp('touched').$onUpdate(() => new Date()),
    slot: integer('slot'),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.parentId], foreignColumns: [parents.companyId, parents.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    check('children_kind_check', oneOf(t.kind, ['a', "it's"])),
    check('children_weird_check', sql`${t.slot} > ${10n}`),
    uniqueIndex().on(t.slot),
    index('children_lower_kind_idx').using('gin', sql`lower(${t.kind})`).where(sql`${t.kind} <> 'x'`),
  ],
);

const profiles = pgTable('profiles', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  childId: integer('child_id')
    .notNull()
    .unique()
    .references(() => children.id, { onDelete: 'cascade' }),
  note: text('note').$defaultFn(() => 'hi'),
});

describe('renderSchemaDiagram on a synthetic schema', () => {
  const synthetic = { parents, children, profiles, again: parents, notATable: 'x', nothing: null };
  const doc = renderSchemaDiagram(synthetic);
  const lines = mermaidLines(doc);

  it('skips non-table exports and counts a table exported twice once', () => {
    expect(collectTables(synthetic).map((table) => table.name)).toEqual(['children', 'parents', 'profiles']);
    expect(doc).toContain('Tables: 3.\n');
    expect(doc).not.toContain('Migrations');
  });

  it('draws composite, required, one-to-one and self-referencing foreign keys', () => {
    expect(lines.filter((line) => RELATIONSHIP.test(line))).toEqual([
      '  children }o--o| children : "previous_id"',
      '  children }o--|| parents : "company_id, parent_id"',
      '  profiles |o--|| children : "child_id"',
    ]);
    expect(doc).toContain(
      '  - (`company_id`, `parent_id`) → `parents` (`company_id`, `id`), on delete cascade, on update cascade (`children_company_id_parent_id_parents_company_id_id_fk`)',
    );
  });

  it('marks table-level primary keys and keys that combine', () => {
    expect(lines).toContain('    uuid company_id PK "not null"');
    expect(lines).toContain('    uuid id PK "not null"');
    expect(lines).toContain('    integer child_id FK, UK "not null"');
    expect(doc).toContain('- **Primary key:** `company_id`, `id`');
    // A one-column unique constraint, and a one-column unique index, make the column UK.
    expect(lines).toContain('    varchar(8) code UK "nullable"');
    expect(lines).toContain('    integer slot UK "nullable"');
  });

  it('renders every kind of default', () => {
    expect(lines).toContain('    numeric(10_2) amount "nullable, default \'0\'"');
    expect(lines).toContain('    double_precision ratio "nullable, default 0.5"');
    expect(lines).toContain('    boolean active "not null, default true"');
    expect(lines).toContain("    text[] tags \"nullable, default '['a','b']'\"");
    expect(lines).toContain('    timestamptz(3) since "nullable, default \'1970-01-01T00:00:00.000Z\'"');
    expect(lines).toContain('    text nothing "nullable, default null"');
    expect(lines).toContain('    serial id PK "not null, default auto-increment"');
    expect(lines).toContain('    text label "nullable, default generated"');
    expect(lines).toContain('    timestamp touched "nullable, default app-side function"');
    expect(lines).toContain('    integer id PK "not null, default identity (always)"');
    expect(lines).toContain('    text note "nullable, default app-side function"');
    expect(lines).toContain("    text kind \"not null, default 'it''s', a|it's\"");
  });

  it('describes checks, unique constraints and indexes in words', () => {
    expect(doc).toContain('  - `parents_amount_check`: `"amount" > 0`');
    expect(doc).toContain("  - `children_kind_check`: `kind` is one of `a`, `it's`");
    expect(doc).toContain('  - `children_weird_check`: `"slot" > $1 (parameters: 10)`');
    expect(doc).toContain('  - `parents_code_unique` (`code`), nulls not distinct');
    expect(doc).toContain('  - `children_slot_index` on (`slot`), unique');
    expect(doc).toContain(
      '  - `children_lower_kind_idx` on (`lower("kind")`), using gin, where `"kind" <> \'x\'`',
    );
    expect(doc).toContain('- **Indexes:** none');
    expect(doc).toContain('- **Checks:** none');
  });

  it('escapes pipes in the Markdown tables', () => {
    expect(doc).toContain("| `kind` | `text` | no | `'it''s'` |  | `a`, `it's` |");
    const pipes = pgTable('pipes', { p: text('p').default('a|b') });
    expect(describeTable(pipes).columns[0]?.default).toBe("'a|b'");
    expect(renderSchemaDiagram({ pipes })).toContain("| `p` | `text` | yes | `'a\\|b'` |  |  |");
  });

  it('is plausible Mermaid and deterministic', () => {
    expectPlausibleMermaid(lines);
    expect(renderSchemaDiagram({ profiles, children, parents })).toBe(doc);
    expect(renderMermaid(collectTables(synthetic))).toBe(lines.join('\n'));
  });

  it('notes a table without a primary key, and an empty journal', () => {
    const loose = pgTable('loose', { note: text('note') });
    const empty = renderSchemaDiagram({ loose }, migrationSummary({ entries: [] }));
    expect(empty).toContain('- **Primary key:** none');
    expect(empty).toContain('Tables: 1. Migrations: none yet.');
  });
});

describe('helpers', () => {
  it('turns SQL types into Mermaid attribute types', () => {
    expect(mermaidType('timestamp with time zone')).toBe('timestamptz');
    expect(mermaidType('time (6) with time zone')).toBe('timetz(6)');
    expect(mermaidType('double precision')).toBe('double_precision');
    expect(mermaidType('numeric(10, 2)')).toBe('numeric(10_2)');
    expect(mermaidType('text[]')).toBe('text[]');
    expect(mermaidType('varchar(255)')).toBe('varchar(255)');
  });

  it('parses only enum-like checks', () => {
    expect(parseOneOf(`"status" in ('a', 'b c', 'it''s')`)).toEqual({
      column: 'status',
      values: ['a', 'b c', "it's"],
    });
    expect(parseOneOf(`"status" not in ('a')`)).toBeUndefined();
    expect(parseOneOf(`"n" > 0`)).toBeUndefined();
    expect(parseOneOf(`"status" in ('a') or "x" in ('b')`)).toBeUndefined();
  });

  it('renders values and SQL', () => {
    expect(valueText(10n)).toBe('10');
    expect(valueText({ a: 1 })).toBe('\'{"a":1}\'');
    expect(sqlText(sql`now()`)).toBe('now()');
    expect(sqlText(sql`${1} + ${'x'}`)).toBe("1 + 'x'");
  });

  it('summarizes a migrations journal and refuses anything else', () => {
    expect(migrationSummary(journal)).toEqual({
      count: journal.entries.length,
      last: journal.entries.at(-1)?.tag,
    });
    expect(migrationSummary({ entries: [] })).toEqual({ count: 0 });
    for (const bad of [null, {}, { entries: {} }, { entries: [{ idx: 0 }] }, { entries: [null] }]) {
      expect(() => migrationSummary(bad)).toThrow(/not a drizzle-kit migrations journal/);
    }
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

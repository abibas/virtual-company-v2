import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  foreignKey,
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
import { describe, expect, it } from 'vitest';
import { collectTables, describeTable, parseOneOf, sqlText, valueText } from '../../src/diagram/describe.ts';
import { mermaidType, renderMermaid } from '../../src/diagram/mermaid.ts';
import { migrationSummary, renderSchemaDiagram } from '../../src/diagram/page.ts';
import { oneOf } from '../../src/schema/columns.ts';
import { expectPlausibleMermaid, journal, mermaidLines, RELATIONSHIP } from '../fixtures/diagram.ts';

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

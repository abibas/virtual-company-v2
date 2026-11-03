/**
 * The schema diagram: `docs/schema.md`, a Mermaid `erDiagram` of every Drizzle table and foreign key
 * followed by a plain-Markdown section per table, rendered from the tables themselves (`getTableConfig`).
 * Pure: the same tables give the same text, so `mwc check` can compare it with the committed file
 * (`scripts/schema-diagram.ts`).
 */
import { getTableName, is, SQL, sql } from 'drizzle-orm';
import {
  getTableConfig,
  type IndexedColumn,
  type PgColumn,
  PgDialect,
  PgTable,
  uniqueKeyName,
} from 'drizzle-orm/pg-core';

export interface ColumnInfo {
  readonly name: string;
  /** The SQL type as in the migration, e.g. `timestamp with time zone`. */
  readonly type: string;
  readonly notNull: boolean;
  /** The default as readable text (`now()`, `'active'`, `newId() (app-side)`), when there is one. */
  readonly default?: string;
  readonly primaryKey: boolean;
  readonly foreignKey: boolean;
  /** Unique on its own (a one-column unique constraint or unique index); not set for primary keys. */
  readonly unique: boolean;
  /** The allowed values when an enum-like CHECK (`<column> in ('a', 'b')`) covers the column. */
  readonly allowedValues?: readonly string[];
}

export interface ForeignKeyInfo {
  readonly name: string;
  readonly columns: readonly string[];
  readonly foreignTable: string;
  readonly foreignColumns: readonly string[];
  readonly onDelete: string;
  readonly onUpdate: string;
  /** Every local column is not null: each row points at exactly one parent. */
  readonly required: boolean;
  /** The local columns are unique (primary key, unique constraint or unique index): at most one child per parent. */
  readonly oneToOne: boolean;
}

export interface CheckInfo {
  readonly name: string;
  /** The CHECK expression with the table's own `"table".` qualifiers removed. */
  readonly sql: string;
  /** Set for an enum-like CHECK: the column and its allowed values. */
  readonly oneOf?: { readonly column: string; readonly values: readonly string[] };
}

export interface UniqueInfo {
  readonly name: string;
  readonly columns: readonly string[];
  readonly nullsNotDistinct: boolean;
}

export interface IndexInfo {
  readonly name: string;
  /** Column names, or the SQL text of an expression. */
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly method: string;
  readonly where?: string;
}

export interface TableInfo {
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKeyInfo[];
  readonly checks: readonly CheckInfo[];
  readonly uniques: readonly UniqueInfo[];
  readonly indexes: readonly IndexInfo[];
}

/** What the header says about `migrations/meta/_journal.json`. */
export interface MigrationSummary {
  readonly count: number;
  /** The tag of the last migration (`0000_init`), when there is one. */
  readonly last?: string;
}

const dialect = new PgDialect();

/**
 * SQL text with its parameters inlined. A parameter Drizzle cannot inline (a bigint, a symbol) falls
 * back to the `$n` text followed by the parameter values.
 */
export function sqlText(value: SQL, invokeSource?: 'indexes'): string {
  try {
    return dialect.sqlToQuery(sql`${value}`.inlineParams(), invokeSource).sql;
  } catch {
    const query = dialect.sqlToQuery(value, invokeSource);
    return `${query.sql} (parameters: ${query.params.map((param) => String(param)).join(', ')})`;
  }
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A column default as readable text. */
export function valueText(value: unknown): string {
  if (is(value, SQL)) return sqlText(value);
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return quote(value.toISOString());
  if (value === null) return 'null';
  return quote(JSON.stringify(value));
}

const appSide = (fn: (...args: never[]) => unknown) =>
  fn.name ? `${fn.name}() (app-side)` : 'app-side function';

function defaultText(column: PgColumn): string | undefined {
  if (column.default !== undefined) return valueText(column.default);
  if (column.defaultFn) return appSide(column.defaultFn);
  // Drizzle calls `$onUpdate` on insert too when there is no other default.
  if (column.onUpdateFn) return appSide(column.onUpdateFn);
  if (column.generatedIdentity) return `identity (${column.generatedIdentity.type})`;
  if (column.generated) return 'generated';
  if (column.getSQLType().endsWith('serial')) return 'auto-increment';
  return undefined;
}

const LITERAL = "'(?:[^']|'')*'";
const ONE_OF = new RegExp(String.raw`^"([^"]+)" in \((${LITERAL}(?:, ${LITERAL})*)\)$`);

/** The column and values of an enum-like CHECK, `"status" in ('a', 'b')` (as `oneOf()` builds it). */
export function parseOneOf(checkSql: string): CheckInfo['oneOf'] {
  const match = ONE_OF.exec(checkSql);
  if (!match?.[1] || !match[2]) return undefined;
  const values = [...match[2].matchAll(new RegExp(LITERAL, 'g'))].map((m) =>
    m[0].slice(1, -1).replaceAll("''", "'"),
  );
  return { column: match[1], values };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((name) => b.includes(name));

/** Everything the diagram and the Markdown say about one table, in declaration order. */
export function describeTable(table: PgTable): TableInfo {
  const config = getTableConfig(table);
  const name = config.name;
  const primaryKey = [
    ...config.columns.filter((column) => column.primary).map((column) => column.name),
    ...config.primaryKeys.flatMap((pk) => pk.columns.map((column) => column.name)),
  ];
  const checks: CheckInfo[] = config.checks.map((check) => {
    const text = sqlText(check.value).replaceAll(`"${name}".`, '');
    const oneOf = parseOneOf(text);
    return { name: check.name, sql: text, ...(oneOf ? { oneOf } : {}) };
  });
  const uniques: UniqueInfo[] = [
    ...config.columns
      .filter((column) => column.isUnique)
      .map((column) => ({
        name: column.uniqueName ?? uniqueKeyName(table, [column.name]),
        columns: [column.name],
        nullsNotDistinct: column.uniqueType === 'not distinct',
      })),
    ...config.uniqueConstraints.map((constraint) => {
      const columns = constraint.columns.map((column) => column.name);
      return {
        name: constraint.getName() ?? uniqueKeyName(table, columns),
        columns,
        nullsNotDistinct: constraint.nullsNotDistinct,
      };
    }),
  ];
  const indexes: IndexInfo[] = config.indexes.map(({ config: index }) => {
    const columns = index.columns.map((column) =>
      is(column, SQL) ? sqlText(column, 'indexes') : String((column as IndexedColumn).name),
    );
    return {
      // drizzle-kit names an unnamed index the same way.
      name: index.name ?? `${name}_${columns.join('_')}_index`,
      columns,
      unique: index.unique,
      method: index.method ?? 'btree',
      ...(index.where ? { where: sqlText(index.where).replaceAll(`"${name}".`, '') } : {}),
    };
  });

  // Column sets that are unique on their own, to tell one-to-one foreign keys from many-to-one.
  const uniqueSets: (readonly string[])[] = [
    ...(primaryKey.length > 0 ? [primaryKey] : []),
    ...uniques.map((unique) => unique.columns),
    ...indexes.filter((index) => index.unique).map((index) => index.columns),
  ];
  const notNull = new Set(config.columns.filter((column) => column.notNull).map((column) => column.name));
  const foreignKeys: ForeignKeyInfo[] = config.foreignKeys.map((fk) => {
    const reference = fk.reference();
    const columns = reference.columns.map((column) => column.name);
    return {
      name: fk.getName(),
      columns,
      foreignTable: getTableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: fk.onDelete ?? 'no action',
      onUpdate: fk.onUpdate ?? 'no action',
      required: columns.every((column) => notNull.has(column)),
      oneToOne: uniqueSets.some((set) => sameSet(set, columns)),
    };
  });

  const inForeignKey = new Set(foreignKeys.flatMap((fk) => fk.columns));
  const soloUnique = new Set(uniqueSets.filter((set) => set.length === 1).map((set) => set[0]));
  const columns: ColumnInfo[] = config.columns.map((column) => {
    const defaultValue = defaultText(column);
    const allowed = checks.find((check) => check.oneOf?.column === column.name)?.oneOf?.values;
    const primary = primaryKey.includes(column.name);
    return {
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull || primary,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      primaryKey: primary,
      foreignKey: inForeignKey.has(column.name),
      unique: !primary && soloUnique.has(column.name),
      ...(allowed ? { allowedValues: allowed } : {}),
    };
  });

  return { name, columns, primaryKey, foreignKeys, checks, uniques, indexes };
}

/** The tables among `exports` (other values are skipped, a table exported twice counts once), sorted by name. */
export function collectTables(exports: Readonly<Record<string, unknown>>): TableInfo[] {
  const tables = new Set(Object.values(exports).filter((value): value is PgTable => is(value, PgTable)));
  return [...tables].map(describeTable).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** An entity or attribute name Mermaid accepts unquoted. */
export function mermaidName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_');
}

/**
 * A SQL type as a Mermaid attribute type (one word: letters, digits, `_ - [ ] ( )`):
 * `timestamp with time zone` becomes `timestamptz`, other spaces and commas become `_`.
 */
export function mermaidType(type: string): string {
  return type
    .replace(
      /^(timestamp|time)( \(\d+\))? with time zone$/,
      (_, base: string, precision = '') => `${base}tz${precision.trim()}`,
    )
    .replace(/[^A-Za-z0-9_\-[\]()]+/g, '_');
}

function attributeLine(column: ColumnInfo): string {
  const keys = [column.primaryKey && 'PK', column.foreignKey && 'FK', column.unique && 'UK'].filter(Boolean);
  const comment = [
    column.notNull ? 'not null' : 'nullable',
    ...(column.default === undefined ? [] : [`default ${column.default}`]),
    ...(column.allowedValues ? [column.allowedValues.join('|')] : []),
  ]
    .join(', ')
    .replaceAll('"', "'");
  const key = keys.length > 0 ? ` ${keys.join(', ')}` : '';
  return `    ${mermaidType(column.type)} ${mermaidName(column.name)}${key} "${comment}"`;
}

/**
 * One relationship per foreign key, child first: `}o--||` many-to-one, `}o--o|` when the foreign key
 * may be null, `|o--` instead of `}o--` when the child's columns are unique (one-to-one).
 */
function relationshipLine(table: TableInfo, fk: ForeignKeyInfo): string {
  const child = fk.oneToOne ? '|o' : '}o';
  const parent = fk.required ? '||' : 'o|';
  return `  ${mermaidName(table.name)} ${child}--${parent} ${mermaidName(fk.foreignTable)} : "${fk.columns.join(', ')}"`;
}

/** The Mermaid `erDiagram` (without the code fence). */
export function renderMermaid(tables: readonly TableInfo[]): string {
  const lines = ['erDiagram'];
  for (const table of tables) {
    lines.push(`  ${mermaidName(table.name)} {`, ...table.columns.map(attributeLine), '  }');
  }
  for (const table of tables) {
    for (const fk of table.foreignKeys) lines.push(relationshipLine(table, fk));
  }
  return lines.join('\n');
}

const code = (text: string) => `\`${text}\``;
const cell = (text: string) => text.replaceAll('|', '\\|');
const columnList = (columns: readonly string[]) => columns.map(code).join(', ');

function listItem(label: string, items: readonly string[]): string[] {
  if (items.length === 0) return [`- **${label}:** none`];
  return [`- **${label}:**`, ...items.map((item) => `  - ${item}`)];
}

function checkWords(check: CheckInfo): string {
  if (check.oneOf) {
    return `${code(check.name)}: ${code(check.oneOf.column)} is one of ${columnList(check.oneOf.values)}`;
  }
  return `${code(check.name)}: ${code(check.sql)}`;
}

function indexWords(index: IndexInfo): string {
  const traits = [
    ...(index.unique ? ['unique'] : []),
    ...(index.method === 'btree' ? [] : [`using ${index.method}`]),
    ...(index.where === undefined ? [] : [`where ${code(index.where)}`]),
  ];
  return `${code(index.name)} on (${columnList(index.columns)})${traits.map((t) => `, ${t}`).join('')}`;
}

function foreignKeyWords(fk: ForeignKeyInfo): string {
  const local = fk.columns.length === 1 ? columnList(fk.columns) : `(${columnList(fk.columns)})`;
  const onUpdate = fk.onUpdate === 'no action' ? '' : `, on update ${fk.onUpdate}`;
  return (
    `${local} → ${code(fk.foreignTable)} (${columnList(fk.foreignColumns)}), ` +
    `on delete ${fk.onDelete}${onUpdate} (${code(fk.name)})`
  );
}

/** The plain-Markdown section of one table: its columns, keys and constraints. */
export function renderTableSection(table: TableInfo): string {
  const lines = [
    `### ${code(table.name)}`,
    '',
    '| Column | Type | Nullable | Default | Key | Allowed values |',
    '| ------ | ---- | -------- | ------- | --- | -------------- |',
  ];
  for (const column of table.columns) {
    const keys = [column.primaryKey && 'PK', column.foreignKey && 'FK', column.unique && 'UK'].filter(
      Boolean,
    );
    lines.push(
      `| ${[
        code(column.name),
        code(column.type),
        column.notNull ? 'no' : 'yes',
        column.default === undefined ? '' : code(column.default),
        keys.join(', '),
        column.allowedValues ? columnList(column.allowedValues) : '',
      ]
        .map(cell)
        .join(' | ')} |`,
    );
  }
  lines.push(
    '',
    `- **Primary key:** ${table.primaryKey.length > 0 ? columnList(table.primaryKey) : 'none'}`,
    ...listItem('Foreign keys', table.foreignKeys.map(foreignKeyWords)),
    ...listItem(
      'Unique',
      table.uniques.map(
        (u) =>
          `${code(u.name)} (${columnList(u.columns)})${u.nullsNotDistinct ? ', nulls not distinct' : ''}`,
      ),
    ),
    ...listItem('Checks', table.checks.map(checkWords)),
    ...listItem('Indexes', table.indexes.map(indexWords)),
  );
  return lines.join('\n');
}

/** The count and last tag of a drizzle-kit `migrations/meta/_journal.json`; throws when it is not one. */
export function migrationSummary(journal: unknown): MigrationSummary {
  const entries = (journal as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry?.tag === 'string')) {
    throw new Error('not a drizzle-kit migrations journal (expected entries with a tag)');
  }
  const last = (entries.at(-1) as { tag: string } | undefined)?.tag;
  return { count: entries.length, ...(last === undefined ? {} : { last }) };
}

const LEGEND = [
  'Legend: `PK` primary key, `FK` foreign key, `UK` unique on its own; each attribute says whether it',
  'may be null, its default and, for an enum-like CHECK, the allowed values. A relationship is drawn',
  'from the table holding the foreign key and labelled with its columns: `}o--||` many-to-one,',
  '`}o--o|` many-to-one where the foreign key may be null, `|o--` one-to-one (the columns are unique).',
];

/**
 * The whole `docs/schema.md`: a header, the Mermaid diagram, then a section per table. Non-table
 * exports are skipped, so a schema module namespace can be passed as it is.
 */
export function renderSchemaDiagram(
  tables: Readonly<Record<string, unknown>>,
  migrations?: MigrationSummary,
): string {
  const infos = collectTables(tables);
  const facts = [`Tables: ${infos.length}.`];
  if (migrations) {
    facts.push(
      migrations.last === undefined
        ? 'Migrations: none yet.'
        : `Migrations: ${migrations.count}, the last is ${code(migrations.last)}.`,
    );
  }
  const lines = [
    '# Database schema',
    '',
    '> Generated from `packages/db/src/schema/` by `pnpm --filter @mwc/db diagram`. Do not edit by',
    '> hand: `pnpm mwc check` fails when this file and the schema disagree.',
    '',
    facts.join(' '),
    '',
    '```mermaid',
    renderMermaid(infos),
    '```',
    '',
    ...LEGEND,
    '',
    '## Tables',
    ...infos.flatMap((table) => ['', renderTableSection(table)]),
  ];
  return `${lines.join('\n')}\n`;
}

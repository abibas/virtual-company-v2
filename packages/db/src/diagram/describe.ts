/**
 * What the schema diagram says about each table, read from the Drizzle tables themselves
 * (`getTableConfig`): columns with their types, defaults and keys, foreign keys, checks, uniques, indexes.
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

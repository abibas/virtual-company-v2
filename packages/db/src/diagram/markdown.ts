import type { CheckInfo, ForeignKeyInfo, IndexInfo, TableInfo } from './describe.ts';

/** Inline code in Markdown. */
export const code = (text: string) => `\`${text}\``;
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

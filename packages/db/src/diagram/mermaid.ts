import type { ColumnInfo, ForeignKeyInfo, TableInfo } from './describe.ts';

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

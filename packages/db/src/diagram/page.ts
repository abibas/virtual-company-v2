/**
 * The schema diagram: `docs/schema.md`, a Mermaid `erDiagram` of every Drizzle table and foreign key
 * followed by a plain-Markdown section per table, rendered from the tables themselves (`getTableConfig`).
 * Pure: the same tables give the same text, so `mwc check` can compare it with the committed file
 * (`scripts/schema-diagram.ts`; dev tooling, the server never loads it). This file puts the page
 * together; describe.ts reads the tables, mermaid.ts draws them and markdown.ts writes the section of each.
 */
import { collectTables } from './describe.ts';
import { code, renderTableSection } from './markdown.ts';
import { renderMermaid } from './mermaid.ts';

/** What the header says about `migrations/meta/_journal.json`. */
export interface MigrationSummary {
  readonly count: number;
  /** The tag of the last migration (`0000_init`), when there is one. */
  readonly last?: string;
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

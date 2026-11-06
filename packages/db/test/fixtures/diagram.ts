/**
 * Shared by the schema diagram tests (test/diagram/): the real migrations journal, and the Mermaid block of a
 * rendered document with a check that it has the shape of an `erDiagram`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { MIGRATIONS_FOLDER } from '../../src/migrate.ts';

/** The repository's drizzle-kit journal (`migrations/meta/_journal.json`). */
export const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ tag: string }>;
};

/** The lines of the Mermaid block of a rendered document. */
export function mermaidLines(doc: string): string[] {
  const block = /```mermaid\n([\s\S]*?)\n```/.exec(doc)?.[1];
  if (block === undefined) throw new Error('no mermaid block');
  return block.split('\n');
}

export const RELATIONSHIP = /^ {2}(\w+) (\}o|\|o)--(\|\||o\|) (\w+) : "([^"]+)"$/;
const ATTRIBUTE = /^ {4}[A-Za-z_][\w\-[\]()]* [A-Za-z_][\w-]*(?: (?:PK|FK|UK)(?:, (?:PK|FK|UK))*)? "[^"]*"$/;

/** Mermaid's erDiagram shape: entity blocks of attribute lines, braces balanced and never nested, then relationships. */
export function expectPlausibleMermaid(lines: readonly string[]): void {
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

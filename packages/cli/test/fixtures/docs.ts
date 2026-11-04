import { warnFigures } from '../../src/structure/docs.ts';
import { STRUCTURE_RULES, type StructureRules } from '../../src/structure/rules.ts';

/** A docs/structure.md that states every rule of `rules`: the clean case of the `docs` rule. */
export function structureDoc(rules: StructureRules = STRUCTURE_RULES): string {
  const { source, test } = rules.maxLines;
  return [
    '# Structure',
    '',
    `At the top level: ${rules.topLevel.map((entry) => `\`${entry}\``).join(', ')}.`,
    `Packages live in ${rules.workspaceGroups.map((group) => `\`${group}/*\``).join(', ')}.`,
    '',
    '  | File | Role |',
    '  | ---- | ---- |',
    ...rules.modules.files.map((file) => `  | \`${file}\` | a role |`),
    '',
    `- Source files: at most ${source} lines. Test files (everything under \`test/\`): at most ${test} lines.`,
    '',
    '| Warning | When |',
    '| ------- | ---- |',
    ...Object.entries(warnFigures(rules)).map(([kind, figures]) => `| \`${kind}\` | ${figures.join(', ')} |`),
    '',
  ].join('\n');
}

/** A keep-structure SKILL.md that places code in every module file and states the limits. */
export function skillDoc(rules: StructureRules = STRUCTURE_RULES): string {
  const { source, test } = rules.maxLines;
  return [
    '---',
    'name: keep-structure',
    'description: Where code goes.',
    '---',
    '',
    ...rules.modules.files.map((file) => `| A role | \`apps/server/src/modules/<area>/${file}\` |`),
    '',
    `- Limits: source files ≤ ${source} lines, files in \`test/\` ≤ ${test}.`,
    '',
  ].join('\n');
}

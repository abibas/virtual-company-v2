import { clipHead, clipLine, isRecord, stringOf, type TurnNotice } from '@mwc/harness-core';
import { NOTICE_MAX, TOOL_RESULT_SUMMARY_MAX, TOOL_SUMMARY_MAX } from '@mwc/shared/harness';

/** One-line summaries of Claude Code's tool calls and their results, for the thread. */

/** The input fields that say what a call does, in the order they are looked for (Bash, the file tools, the web, Task). */
const INPUT_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'url',
  'query',
  'pattern',
  'path',
  'skill',
  'description',
  'prompt',
] as const;

/** A tool call's input in one line: its command, file, pattern or address; its JSON when none says it; '' for none. */
export function toolSummary(input: unknown): string {
  if (!isRecord(input)) return '';
  if (Array.isArray(input.todos)) return `${input.todos.length} to-dos`;
  const pattern = stringOf(input.pattern);
  const path = stringOf(input.path);
  if (pattern !== undefined && path !== undefined) return clipLine(`${pattern} in ${path}`, TOOL_SUMMARY_MAX);
  for (const key of INPUT_KEYS) {
    const value = stringOf(input[key]);
    if (value !== undefined && value.trim() !== '') return clipLine(value, TOOL_SUMMARY_MAX);
  }
  const json = JSON.stringify(input);
  return json === '{}' ? '' : clipLine(json, TOOL_SUMMARY_MAX);
}

/** A tool result's text: a string, or its text blocks one per line (an image as `[image]`). */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!isRecord(block)) return '';
      if (block.type === 'image') return '[image]';
      return block.type === 'text' ? (stringOf(block.text) ?? '') : '';
    })
    .filter((text) => text !== '')
    .join('\n');
}

/** A tool result's summary: the start of its text. */
export function resultSummary(content: unknown): string {
  return clipHead(resultText(content), TOOL_RESULT_SUMMARY_MAX);
}

/** The notice for one of a result's `permission_denials`: which tool was refused, and what it would have done. */
export function denialNotice(denial: unknown): TurnNotice | null {
  if (!isRecord(denial)) return null;
  const tool = stringOf(denial.tool_name) ?? 'A tool';
  const what = toolSummary(denial.tool_input);
  const message = `Refused for permission: ${tool}${what === '' ? '' : ` (${what})`}`;
  return { type: 'notice', level: 'warn', message: clipHead(message, NOTICE_MAX) };
}

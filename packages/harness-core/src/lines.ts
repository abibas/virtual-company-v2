import type { Harness } from '@mwc/shared/enums';
import { RESULT_ERROR_MAX, type TurnEventOf } from '@mwc/shared/harness';
import { clipTail } from './text.ts';

/** What every parser shares: reading a JSON line safely, its fields by type, and the failing end of a turn. */

/** The harnesses' names, as messages show them. */
export const HARNESS_LABELS: Readonly<Record<Harness, string>> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
};

export type JsonRecord = Readonly<Record<string, unknown>>;

/** True for a JSON object (not an array, not null). */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON object on a line; null for a blank or partial line, a line that is not JSON, or JSON that is no object. */
export function parseJsonLine(line: string): JsonRecord | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** A string field, or undefined for anything else. */
export function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A count field: a finite number of zero or more, rounded; undefined for anything else. */
export function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/**
 * The `result` of a turn that ended without one: how the process ended, and the first of `details` that says
 * something (the harness's own error, the end of stderr, a stray line), cut from the start to fit.
 */
export function failedResult(
  harness: Harness,
  exitCode: number | null,
  details: readonly (string | undefined)[],
): TurnEventOf<'result'> {
  const label = HARNESS_LABELS[harness];
  const how =
    exitCode === null
      ? `${label} was stopped before it finished the turn`
      : exitCode === 0
        ? `${label} ended without finishing the turn`
        : `${label} exited with code ${exitCode}`;
  const detail = details.map((text) => text?.trim() ?? '').find((text) => text !== '');
  const error = detail === undefined ? how : `${how}: ${clipTail(detail, RESULT_ERROR_MAX - how.length - 2)}`;
  return { type: 'result', ok: false, error };
}

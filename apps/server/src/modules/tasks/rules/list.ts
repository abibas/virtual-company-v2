import { TaskState } from '@mwc/shared/enums';
import { taskNumber } from '@mwc/shared/flows';

/**
 * The task list's query, read (pure): several states at once (`state=queued,active`), a text search on the key and
 * the title (`q`), and the cursor of a page in either order (`sort=created`, newest first; `sort=updated`, the latest
 * activity first).
 */

/** `queued`, or several states with commas between them: what `?state=` accepts. */
export const STATES_PATTERN = new RegExp(
  `^(${TaskState.options.join('|')})(,(${TaskState.options.join('|')}))*$`,
);

/** The states a `?state=` names, each once. */
export const statesOf = (state: string): TaskState[] => [
  ...new Set(state.split(',').map((one) => TaskState.parse(one))),
];

/** What a search matches: a task's number (the key `T-12`, any case, or `12` alone) or a part of its title. */
export interface TaskSearch {
  readonly number: number | undefined;
  /** The text a title contains, any case. */
  readonly title: string;
}

/** The search a `?q=` asks for; undefined for an empty one. */
export function searchOf(q: string | undefined): TaskSearch | undefined {
  const text = q?.trim() ?? '';
  if (text === '') return undefined;
  const number = /^[1-9]\d{0,8}$/.test(text) ? Number(text) : taskNumber(text);
  return { number, title: text };
}

/** `%`, `_` and `\` taken literally in a `LIKE` pattern. */
export const likeLiteral = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Where a page ends: the last task's last change (to the millisecond) and its number. */
export interface TaskCursor {
  readonly updatedAt: Date;
  readonly number: number;
}

/** `?cursor=`: the milliseconds of the last change, a dot, the number. */
export const CURSOR_PATTERN = /^\d{1,15}\.[1-9]\d{0,8}$/;

export const cursorText = (cursor: TaskCursor): string => `${cursor.updatedAt.getTime()}.${cursor.number}`;

/** The cursor a `?cursor=` (matching `CURSOR_PATTERN`) names. */
export function cursorOf(text: string): TaskCursor {
  const [ms, number] = text.split('.');
  return { updatedAt: new Date(Number(ms)), number: Number(number) };
}

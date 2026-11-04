/** Joins class names, dropping the falsy ones: `cx('a', cond && 'b', undefined)` → `'a b'`. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

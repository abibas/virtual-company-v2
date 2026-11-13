/**
 * A search kept inside the profile's projects or spaces (S7.1c): a JQL or CQL query ANDed with `project in (…)` or
 * `space in (…)` when the scope is not `all`, its `ORDER BY` kept at the end. The query is read first so it cannot
 * escape the group it is put in: its quotes must close and its parentheses balance outside them, never closing more than
 * it opened (`a) OR (b` would otherwise reach past the scope). The tools also drop any result outside the scope.
 */

export type ScopedQuery =
  | { readonly ok: true; readonly query: string }
  | { readonly ok: false; readonly error: string };

/** True when `ORDER BY` starts at `i` as words of their own (after nothing, a space or a parenthesis). */
function startsOrderBy(query: string, i: number): boolean {
  const before = query[i - 1];
  if (before !== undefined && !/[\s)]/.test(before)) return false;
  ORDER_BY.lastIndex = i;
  return ORDER_BY.test(query);
}

const ORDER_BY = /order\s+by\b/iy;

/** Where a query's top-level `ORDER BY` starts, or why the query cannot be scoped. */
export function readQuery(query: string): { readonly orderAt: number } | { readonly error: string } {
  let depth = 0;
  let quote: string | undefined;
  let orderAt = -1;
  for (let i = 0; i < query.length; i++) {
    const char = query[i] as string;
    if (quote !== undefined) {
      if (char === '\\') i++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth < 0) return { error: 'it closes a parenthesis it never opened' };
    else if (depth === 0 && orderAt < 0 && startsOrderBy(query, i)) orderAt = i;
  }
  if (quote !== undefined) return { error: 'a quoted text in it never ends' };
  if (depth !== 0) return { error: 'a parenthesis in it never closes' };
  return { orderAt };
}

/** A key list as the query language quotes it: `"AP", "SS"`. */
const quoted = (keys: readonly string[]) =>
  keys.map((key) => `"${key.replace(/["\\]/g, '\\$&')}"`).join(', ');

/**
 * The query kept to `keys` of `field` (`project` for JQL, `space` for CQL), or why not; unchanged for `all`. `language`
 * names it in the refusal.
 */
export function scopedQuery(
  query: string,
  field: 'project' | 'space',
  keys: 'all' | readonly string[],
  language: 'JQL' | 'CQL',
): ScopedQuery {
  const read = readQuery(query);
  if ('error' in read)
    return { ok: false, error: `The ${language} cannot be used as written: ${read.error}.` };
  if (keys === 'all') return { ok: true, query };
  const clause = (read.orderAt < 0 ? query : query.slice(0, read.orderAt)).trim();
  const order = read.orderAt < 0 ? '' : ` ${query.slice(read.orderAt).trim()}`;
  const scope = `${field} in (${quoted(keys)})`;
  return { ok: true, query: `${clause === '' ? scope : `${scope} AND (${clause})`}${order}` };
}

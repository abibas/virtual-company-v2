/**
 * The slug rule of companies and agents (their CHECKs, `companies_slug_check` and `agents_slug_check`): lower-case
 * kebab, 1 to 63 characters, no dash at either end. A slug the caller leaves out is derived from a name.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const SLUG_MAX = 63;

/** Cuts a slug to `max` characters and drops the dashes that end up at its end. */
function cut(slug: string, max: number): string {
  return slug.slice(0, max).replace(/-+$/, '');
}

/**
 * A slug from a name: accents dropped (`Café` → `cafe`), lower-cased, every run of other characters one dash, no dash
 * at either end, at most 63 characters; `fallback` (`company`, `agent`) when nothing is left.
 */
export function slugify(name: string, fallback: string): string {
  const kebab = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '');
  return cut(kebab, SLUG_MAX) || fallback;
}

/** `base-suffix`, with `base` cut so the whole stays within 63 characters. */
export function withSuffix(base: string, suffix: string): string {
  return `${cut(base, SLUG_MAX - suffix.length - 1)}-${suffix}`;
}

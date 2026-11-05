/**
 * The address rule of the server (`companies/rules.ts`), mirrored for the browser's own check and the live
 * `/c/<address>` preview. The server stays the judge: a taken address gets a suffix there.
 */
export const SLUG_INPUT_PATTERN = '[a-z0-9]([a-z0-9\\-]{0,61}[a-z0-9])?';
export const SLUG_MAX = 63;
const FALLBACK_SLUG = 'company';

/**
 * The address the server makes from a name: accents dropped (`Café` → `cafe`), lower-cased, every run of other
 * characters one dash, no dash at either end, at most 63 characters; `company` when nothing is left.
 */
export function slugify(name: string): string {
  const kebab = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '');
  return kebab.slice(0, SLUG_MAX).replace(/-+$/, '') || FALLBACK_SLUG;
}

/** The address a new company gets: the one typed, else the one made from the name, else nothing yet. */
export function companyAddress(name: string, chosen: string): string {
  const typed = chosen.trim();
  if (typed) return typed;
  return name.trim() ? slugify(name) : '';
}

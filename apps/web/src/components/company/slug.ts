import { isReservedSlug, slugify as slugifyOr, withSuffix } from '@mwc/shared/slugs';

/**
 * The address rule of the server (`@mwc/shared/slugs`) as an input's `pattern`, for the browser's own check (browsers
 * compile it with the `v` flag, where a dash in a class is escaped); the helpers below make the live `/<address>`
 * preview. The server stays the judge: a taken address gets a suffix there.
 */
export const SLUG_INPUT_PATTERN = '[a-z0-9]([a-z0-9\\-]{0,61}[a-z0-9])?';
const FALLBACK_SLUG = 'company';

/**
 * The address the server makes from a name: accents dropped (`Café` → `cafe`), lower-cased, every run of other
 * characters one dash, no dash at either end, at most 63 characters; `company` when nothing is left; and a word the
 * app keeps for its own pages (`Settings`) with `-2`, as the server moves it on.
 */
export function slugify(name: string): string {
  const slug = slugifyOr(name, FALLBACK_SLUG);
  return isReservedSlug(slug) ? withSuffix(slug, '2') : slug;
}

/** The address a new company gets: the one typed, else the one made from the name, else nothing yet. */
export function companyAddress(name: string, chosen: string): string {
  const typed = chosen.trim();
  if (typed) return typed;
  return name.trim() ? slugify(name) : '';
}

/** The friendly line under an address field when the address typed is kept for the app's own pages. */
export function reservedAddressError(address: string): string | undefined {
  const typed = address.trim();
  return isReservedSlug(typed)
    ? `/${typed} is kept for the app’s own pages; choose another address.`
    : undefined;
}

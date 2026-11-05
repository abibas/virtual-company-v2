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

/**
 * The first path segments the web app and the server use, now or soon. A company lives at `/<slug>`, so its slug is
 * never one of these: the server refuses a chosen one (422 `slug_reserved`) and moves a derived one on to its next
 * suffix, and the web shows the not-found page for one that is no page of its own. Agents need no list: they live
 * under their company's path. Names with a dot can never be slugs; they are listed so this stays the whole list.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // The web app's own pages, and the old company prefix (`/c/<slug>` redirects to `/<slug>`).
  'c',
  'sign-in',
  'sign-up',
  'sign-out',
  'sso-callback',
  'accept-invitation',
  'companies',
  'onboarding',
  'profile',
  'account',
  'settings',
  'me',
  'new',
  'admin',
  'design',
  'login',
  'logout',
  'auth',
  'oauth',
  'invitations',
  'help',
  // The server: the API, the probes, the built web's files and the dev server's sources.
  'api',
  'healthz',
  'readyz',
  'health',
  'status',
  'metrics',
  'scim',
  'webhooks',
  'docs',
  'assets',
  'static',
  'public',
  'src',
  'favicon.ico',
  'robots.txt',
]);

/** True when `slug` is a first path segment the app or the server keeps for itself (`RESERVED_SLUGS`). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

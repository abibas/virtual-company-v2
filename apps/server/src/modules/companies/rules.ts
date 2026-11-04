import type { CompanyCreation } from '@mwc/shared/config';

/** The slug rule of `companies.slug` (its CHECK): lower-case kebab, 1 to 63 characters, no dash at either end. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const SLUG_MAX = 63;
/** The slug of a name with no letter or digit in it (`!!!`, `日本`). */
export const FALLBACK_SLUG = 'company';
/** The longest company name, after trimming. */
export const NAME_MAX = 100;
/** A derived slug that is taken is tried again with `-2` … `-10`, then with this many random suffixes. */
export const NUMBERED_SLUGS = 9;
export const RANDOM_SLUGS = 3;

/** Cuts a slug to `max` characters and drops the dashes that end up at its end. */
function cut(slug: string, max: number): string {
  return slug.slice(0, max).replace(/-+$/, '');
}

/**
 * A slug from a company name: accents dropped (`Café` → `cafe`), lower-cased, every run of other characters one
 * dash, no dash at either end, at most 63 characters; `company` when nothing is left.
 */
export function slugify(name: string): string {
  const kebab = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '');
  return cut(kebab, SLUG_MAX) || FALLBACK_SLUG;
}

/** `base-suffix`, with `base` cut so the whole stays within 63 characters. */
export function withSuffix(base: string, suffix: string): string {
  return `${cut(base, SLUG_MAX - suffix.length - 1)}-${suffix}`;
}

/**
 * The slugs a new company tries, in order (the first free one wins). A slug the caller chose is the only one, so a
 * taken one is refused; a slug derived from the name is followed by `-2` … `-10` and then random suffixes, so a
 * common name still finds a free slug.
 */
export function slugCandidates(name: string, chosen: string | undefined, random: () => string): string[] {
  if (chosen !== undefined) return [chosen];
  const base = slugify(name);
  const numbered = Array.from({ length: NUMBERED_SLUGS }, (_, i) => withSuffix(base, String(i + 2)));
  const randoms = Array.from({ length: RANDOM_SLUGS }, () => withSuffix(base, random()));
  return [base, ...numbered, ...randoms];
}

/** Why the creation policy refuses someone, or undefined when it lets them create a company. */
export type CreationRefusal = 'company_creation_disabled' | 'company_creation_not_allowed';

/**
 * The creation policy (MWC_COMPANY_CREATION): `any` lets everyone signed in create companies, `allowlist` only the
 * people whose primary email is in MWC_COMPANY_CREATORS (lower-cased), `none` nobody.
 */
export function creationRefusal(
  policy: CompanyCreation,
  creators: readonly string[],
  email: string | undefined,
): CreationRefusal | undefined {
  if (policy === 'none') return 'company_creation_disabled';
  if (policy === 'allowlist' && !creators.includes(email?.toLowerCase() ?? '')) {
    return 'company_creation_not_allowed';
  }
  return undefined;
}

/** The name typed to confirm a deletion matches the company's, around which spaces do not count. */
export function nameConfirmed(typed: string, name: string): boolean {
  return typed.trim() === name;
}

/** The fields of a patch whose value differs from the company's: an unchanged field writes nothing. */
export function changedFields(
  company: { readonly name: string; readonly slug: string },
  patch: { readonly name?: string | undefined; readonly slug?: string | undefined },
): { name?: string; slug?: string } {
  return {
    ...(patch.name === undefined || patch.name === company.name ? {} : { name: patch.name }),
    ...(patch.slug === undefined || patch.slug === company.slug ? {} : { slug: patch.slug }),
  };
}

/** The company fields the audit log follows. */
export type AuditedCompany = {
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly identityOrgId: string | null;
  readonly deletedAt: Date | null;
};

/** The audited fields of a company row, for `diffFields(before, after)`. */
export function audited(company: AuditedCompany): AuditedCompany {
  const { name, slug, status, identityOrgId, deletedAt } = company;
  return { name, slug, status, identityOrgId, deletedAt };
}

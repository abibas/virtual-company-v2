import type { CompanyCreation } from '@mwc/shared/config';
import type { LogoContentType } from '@mwc/shared/enums';
import { isReservedSlug, slugify as slugifyOr, withSuffix } from '@mwc/shared/slugs';

// The slug rule is shared with agents (`@mwc/shared/slugs`); re-exported here so its imports stay where they were.
export { isReservedSlug, SLUG_MAX, SLUG_PATTERN, withSuffix } from '@mwc/shared/slugs';

/** The slug of a name with no letter or digit in it (`!!!`, `日本`). */
export const FALLBACK_SLUG = 'company';
/** The longest company name, after trimming. */
export const NAME_MAX = 100;
/** A derived slug that is taken is tried again with `-2` … `-10`, then with this many random suffixes. */
export const NUMBERED_SLUGS = 9;
export const RANDOM_SLUGS = 3;

/**
 * A slug from a company name: accents dropped (`Café` → `cafe`), lower-cased, every run of other characters one
 * dash, no dash at either end, at most 63 characters; `company` when nothing is left.
 */
export function slugify(name: string): string {
  return slugifyOr(name, FALLBACK_SLUG);
}

/**
 * The slugs a new company tries, in order (the first free one wins). A slug the caller chose is the only one, so a
 * taken one is refused (a reserved one never gets here: the service refuses it first); a slug derived from the name
 * is followed by `-2` … `-10` and then random suffixes, so a common name still finds a free slug, and a derived slug
 * that is a reserved word (`Settings`) starts at its `-2`, the way a taken one moves on.
 */
export function slugCandidates(name: string, chosen: string | undefined, random: () => string): string[] {
  if (chosen !== undefined) return [chosen];
  const base = slugify(name);
  const numbered = Array.from({ length: NUMBERED_SLUGS }, (_, i) => withSuffix(base, String(i + 2)));
  const randoms = Array.from({ length: RANDOM_SLUGS }, () => withSuffix(base, random()));
  return [base, ...numbered, ...randoms].filter((slug) => !isReservedSlug(slug));
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

/** The first bytes of an image type; null matches any byte. */
interface Signature {
  readonly type: LogoContentType;
  readonly bytes: readonly (number | null)[];
}

/** The first bytes of each image type a logo may be: the type is told from these, never from a name or a header. */
const SIGNATURES: readonly Signature[] = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  // RIFF, the 4-byte size of the rest (any), WEBP.
  { type: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
];

/**
 * The image type a logo's bytes show (PNG, JPEG or WebP), or undefined for anything else: SVG (which can carry
 * scripts), GIF, other images, text. A declared type or a file name never counts.
 */
export function detectLogoType(bytes: Uint8Array): LogoContentType | undefined {
  return SIGNATURES.find(
    (signature) =>
      bytes.length >= signature.bytes.length &&
      signature.bytes.every((byte, i) => byte === null || bytes[i] === byte),
  )?.type;
}

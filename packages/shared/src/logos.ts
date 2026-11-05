import { z } from 'zod';

/**
 * The company logo contract the server and the web share (docs/architecture.md, "Company logos"): a logo is at most
 * `LOGO_MAX_BYTES` (the `company_logos.size` CHECK), and its version is the start of its SHA-256, which company and
 * `GET /api/me` responses carry, so the web asks for `GET .../logo?v=<version>`: a URL that changes with the logo.
 */

/** The largest logo, in bytes: 1 MB (1,048,576 bytes). */
export const LOGO_MAX_BYTES = 1_048_576;

/** How many hex characters of the SHA-256 make a logo's version. */
export const LOGO_VERSION_LENGTH = 16;

/** A company's logo as company and membership responses name it (null there for a company without one). */
export const LogoRef = z.object({
  version: z.string().describe('The first 16 hex characters of the logo SHA-256; changes with the logo'),
});
export type LogoRef = z.infer<typeof LogoRef>;

/** A logo's version: the first `LOGO_VERSION_LENGTH` characters of its SHA-256 (hex). */
export function logoVersion(sha256: string): string {
  return sha256.slice(0, LOGO_VERSION_LENGTH);
}

/** The logo of a company whose logo has this SHA-256, or null for a company without one. */
export function logoRef(sha256: string | null | undefined): LogoRef | null {
  return sha256 ? { version: logoVersion(sha256) } : null;
}

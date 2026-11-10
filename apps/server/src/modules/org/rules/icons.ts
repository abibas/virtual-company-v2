import type { Agent } from '@mwc/db';
import type { AgentIconContentType } from '@mwc/shared/enums';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { detectLogoType } from '../../companies/rules.ts';

// An agent's icon (docs/architecture.md, "Agent icons"): which image types an upload may be, why one is refused, and
// what the audit log keeps of an icon. Pure.

/** GIF87a or GIF89a: the six bytes every GIF starts with. */
const GIF = [0x47, 0x49, 0x46, 0x38, null, 0x61] as const;

/**
 * The image type an icon's bytes show: a logo's (PNG, JPEG, WebP) or a GIF; undefined for anything else (SVG, which can
 * carry scripts, other images, text). A declared type or a file name never counts.
 */
export function detectIconType(bytes: Uint8Array): AgentIconContentType | undefined {
  const logo = detectLogoType(bytes);
  if (logo !== undefined) return logo;
  const gif = bytes.length >= GIF.length && GIF.every((byte, i) => byte === null || bytes[i] === byte);
  return gif && (bytes[4] === 0x37 || bytes[4] === 0x39) ? 'image/gif' : undefined;
}

/** Why an uploaded icon is refused, answered in the common error shape. */
export interface IconRefusal {
  readonly ok: false;
  readonly status: 400 | 413 | 415;
  readonly code: 'icon_empty' | 'icon_too_large' | 'icon_type_unsupported';
  readonly message: string;
}

export const ICON_EMPTY: IconRefusal = {
  ok: false,
  status: 400,
  code: 'icon_empty',
  message: 'The file is empty',
};

export const ICON_TOO_LARGE: IconRefusal = {
  ok: false,
  status: 413,
  code: 'icon_too_large',
  message: `An agent's icon may be at most ${LOGO_MAX_BYTES} bytes (1 MB)`,
};

export const ICON_TYPE_UNSUPPORTED: IconRefusal = {
  ok: false,
  status: 415,
  code: 'icon_type_unsupported',
  message: "An agent's icon must be a PNG, JPEG, WebP or GIF image",
};

/**
 * Why an uploaded file cannot be an icon, or its type: 400 for an empty file, 413 over 1 MB, 415 unless its bytes are a
 * PNG, JPEG, WebP or GIF image.
 */
export function iconFileType(bytes: Uint8Array): AgentIconContentType | IconRefusal {
  if (bytes.length === 0) return ICON_EMPTY;
  if (bytes.length > LOGO_MAX_BYTES) return ICON_TOO_LARGE;
  return detectIconType(bytes) ?? ICON_TYPE_UNSUPPORTED;
}

/** What an icon is, as the audit log keeps it: its kind, with its emoji or its image's SHA-256. */
export type AuditedIcon =
  | { readonly kind: 'face' }
  | { readonly kind: 'emoji'; readonly emoji: string }
  | { readonly kind: 'image'; readonly sha256: string };

/** The icon an agent's row and its image (the SHA-256, null for none) make, for the audit log's `icon` field. */
export function auditedIcon(
  agent: Pick<Agent, 'iconKind' | 'iconEmoji'>,
  sha256: string | null,
): AuditedIcon {
  if (agent.iconKind === 'emoji' && agent.iconEmoji) return { kind: 'emoji', emoji: agent.iconEmoji };
  if (agent.iconKind === 'image' && sha256) return { kind: 'image', sha256 };
  return { kind: 'face' };
}

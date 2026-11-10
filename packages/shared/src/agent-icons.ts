import type { AgentIconKind } from './enums.ts';
import { logoVersion } from './logos.ts';

/**
 * An agent's icon, the contract the server and the web share (docs/architecture.md, "Agent icons"): its drawn face
 * (`agents.face`, the default), one emoji, or an uploaded image (`agent_icons`, at most `LOGO_MAX_BYTES`, PNG, JPEG,
 * WebP or GIF). An image is named by its version, the start of its SHA-256 as a logo's, so the web asks for
 * `GET .../agents/:agentId/icon?v=<version>`: a URL that changes with the image.
 */

/** The longest emoji an agent's icon takes, in code points (`agents_icon_emoji_check`): room for a ZWJ sequence. */
export const AGENT_EMOJI_MAX = 16;

/** An agent's icon as agent and chart responses show it. */
export type AgentIconView =
  | { readonly kind: 'face' }
  | { readonly kind: 'emoji'; readonly emoji: string }
  | { readonly kind: 'image'; readonly version: string };

/** A pictograph, a flag's regional indicators, or a keycap: what makes a grapheme an emoji. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
/** Spaces, line breaks and control characters: never part of an emoji. */
const FORBIDDEN = /[\p{White_Space}\p{Cc}]/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Whether `text` is one emoji as an icon takes it: a single grapheme (so a skin tone, a ZWJ family or a flag counts as
 * one), at most `AGENT_EMOJI_MAX` code points, with a pictograph, a flag or a keycap in it, and no space or control
 * character. Plain letters and digits are not emoji.
 */
export function isAgentEmoji(text: string): boolean {
  if (text.length === 0 || [...text].length > AGENT_EMOJI_MAX) return false;
  if (FORBIDDEN.test(text) || !PICTOGRAPHIC.test(text)) return false;
  return [...graphemes.segment(text)].length === 1;
}

/**
 * The icon an agent's row and its image (the image's SHA-256, null for none) make: the emoji, the image by its
 * version, else the face. A kind whose part is missing falls back to the face.
 */
export function agentIconView(
  kind: AgentIconKind,
  emoji: string | null,
  imageSha256: string | null | undefined,
): AgentIconView {
  if (kind === 'emoji' && emoji) return { kind, emoji };
  if (kind === 'image' && imageSha256) return { kind, version: logoVersion(imageSha256) };
  return { kind: 'face' };
}

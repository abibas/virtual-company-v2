import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { describe, expect, it } from 'vitest';
import {
  auditedIcon,
  detectIconType,
  ICON_EMPTY,
  ICON_TOO_LARGE,
  ICON_TYPE_UNSUPPORTED,
  iconFileType,
} from '../../../../src/modules/org/rules/icons.ts';
import { GIF, JPEG, PNG, SVG, WEBP } from '../../../fixtures/companies/logos.ts';

const ascii = (text: string) => new TextEncoder().encode(text);

describe('detectIconType', () => {
  it("tells a logo's types and a GIF (87a and 89a) from their first bytes", () => {
    expect(detectIconType(PNG)).toBe('image/png');
    expect(detectIconType(JPEG)).toBe('image/jpeg');
    expect(detectIconType(WEBP)).toBe('image/webp');
    expect(detectIconType(GIF)).toBe('image/gif');
    expect(detectIconType(ascii('GIF87a...'))).toBe('image/gif');
  });

  it('refuses an SVG, text, another GIF-like header and a file too short to tell', () => {
    for (const bytes of [SVG, ascii('hello'), ascii('GIF80a'), ascii('GIF8')]) {
      expect(detectIconType(bytes)).toBeUndefined();
    }
  });
});

describe('iconFileType', () => {
  it('refuses an empty file, one over 1 MB and one of another type', () => {
    expect(iconFileType(new Uint8Array())).toBe(ICON_EMPTY);
    expect(iconFileType(new Uint8Array(LOGO_MAX_BYTES + 1))).toBe(ICON_TOO_LARGE);
    expect(iconFileType(SVG)).toBe(ICON_TYPE_UNSUPPORTED);
    expect(iconFileType(GIF)).toBe('image/gif');
  });
});

describe('auditedIcon', () => {
  it('keeps the kind with its emoji or its image hash, else the face', () => {
    expect(auditedIcon({ iconKind: 'face', iconEmoji: null }, null)).toEqual({ kind: 'face' });
    expect(auditedIcon({ iconKind: 'emoji', iconEmoji: '🤖' }, null)).toEqual({ kind: 'emoji', emoji: '🤖' });
    expect(auditedIcon({ iconKind: 'image', iconEmoji: null }, 'abc')).toEqual({
      kind: 'image',
      sha256: 'abc',
    });
    expect(auditedIcon({ iconKind: 'image', iconEmoji: null }, null)).toEqual({ kind: 'face' });
  });
});

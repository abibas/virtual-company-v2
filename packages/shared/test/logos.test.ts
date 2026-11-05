import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, LOGO_VERSION_LENGTH, LogoRef, logoRef, logoVersion } from '../src/logos.ts';

const sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('the company logo contract', () => {
  it('allows a logo of at most 1 MB', () => {
    expect(LOGO_MAX_BYTES).toBe(1024 * 1024);
  });

  it('versions a logo by the first 16 hex characters of its SHA-256', () => {
    expect(LOGO_VERSION_LENGTH).toBe(16);
    expect(logoVersion(sha256)).toBe('9f86d081884c7d65');
  });

  it('names a logo by its version, and no logo as null', () => {
    expect(logoRef(sha256)).toEqual({ version: '9f86d081884c7d65' });
    expect(LogoRef.parse(logoRef(sha256))).toEqual({ version: '9f86d081884c7d65' });
    expect(logoRef(null)).toBeNull();
    expect(logoRef(undefined)).toBeNull();
    expect(logoRef('')).toBeNull();
  });
});

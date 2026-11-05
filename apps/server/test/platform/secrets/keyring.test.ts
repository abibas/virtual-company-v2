import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  ephemeralKeyring,
  IV_BYTES,
  Keyring,
  keyringOf,
  type Sealed,
  SecretOpenError,
  TAG_BYTES,
} from '../../../src/platform/secrets/keyring.ts';

const AAD =
  'credential|019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b|019a5a10-0000-7000-8000-000000000001|claude_setup_token';
const SECRET = { token: 'sk-ant-oat01-round-trip-secret' };

/** The reason a sealed value did not open, or 'opened'. */
function failure(keyring: Keyring, sealed: Sealed, aad = AAD): string {
  try {
    keyring.open(sealed, aad);
    return 'opened';
  } catch (error) {
    expect(error).toBeInstanceOf(SecretOpenError);
    expect((error as Error).message).not.toContain(SECRET.token);
    return (error as SecretOpenError).reason;
  }
}

/** A copy of the bytes with one bit flipped at `index`. */
const flipped = (bytes: Uint8Array, index = 0) => {
  const copy = new Uint8Array(bytes);
  copy[index] = (copy[index] as number) ^ 0x01;
  return copy;
};

describe('Keyring', () => {
  it('seals a JSON value with AES-256-GCM and opens it again with the same additional data', () => {
    const keyring = ephemeralKeyring();
    const sealed = keyring.seal(SECRET, AAD);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.iv).toHaveLength(IV_BYTES);
    expect(sealed.tag).toHaveLength(TAG_BYTES);
    expect(Buffer.from(sealed.ciphertext).toString('utf8')).not.toContain('sk-ant');
    expect(keyring.open(sealed, AAD)).toEqual(SECRET);
    expect(keyring.open(keyring.seal({ headers: { 'x-api-key': 'k' } }, 'other'), 'other')).toEqual({
      headers: { 'x-api-key': 'k' },
    });
  });

  it('draws a new IV for every seal, so the same secret never seals the same way twice', () => {
    const keyring = ephemeralKeyring();
    const first = keyring.seal(SECRET, AAD);
    const second = keyring.seal(SECRET, AAD);
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });

  it('refuses a changed ciphertext, IV or tag', () => {
    const keyring = ephemeralKeyring();
    const sealed = keyring.seal(SECRET, AAD);
    expect(failure(keyring, { ...sealed, ciphertext: flipped(sealed.ciphertext, 3) })).toBe('unreadable');
    expect(failure(keyring, { ...sealed, iv: flipped(sealed.iv) })).toBe('unreadable');
    expect(failure(keyring, { ...sealed, tag: flipped(sealed.tag, TAG_BYTES - 1) })).toBe('unreadable');
    expect(failure(keyring, { ...sealed, tag: sealed.tag.slice(0, 12) })).toBe('unreadable');
    expect(failure(keyring, { ...sealed, iv: new Uint8Array(16) })).toBe('unreadable');
    expect(failure(keyring, sealed)).toBe('opened');
  });

  it('refuses other additional data: another id, owner or kind', () => {
    const keyring = ephemeralKeyring();
    const sealed = keyring.seal(SECRET, AAD);
    const [, id, owner, kind] = AAD.split('|') as [string, string, string, string];
    expect(failure(keyring, sealed, AAD.replace(id, '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2c'))).toBe(
      'unreadable',
    );
    expect(failure(keyring, sealed, AAD.replace(owner, '019a5a10-0000-7000-8000-000000000002'))).toBe(
      'unreadable',
    );
    expect(failure(keyring, sealed, AAD.replace(kind, 'anthropic_api_key'))).toBe('unreadable');
    expect(failure(keyring, sealed, '')).toBe('unreadable');
  });

  it('refuses a value sealed under another master key', () => {
    const sealed = ephemeralKeyring().seal(SECRET, AAD);
    expect(failure(ephemeralKeyring(), sealed)).toBe('unreadable');
  });

  it('opens each value with the key of its version, seals with the current one, and refuses an unknown version', () => {
    const one = randomBytes(32);
    const two = randomBytes(32);
    const old = keyringOf(one).seal(SECRET, AAD);
    const rotated = new Keyring(
      new Map([
        [1, one],
        [2, two],
      ]),
      2,
    );
    expect(rotated.versions).toEqual([1, 2]);
    expect(rotated.open(old, AAD)).toEqual(SECRET);
    const fresh = rotated.seal(SECRET, AAD);
    expect(fresh.keyVersion).toBe(2);
    expect(failure(keyringOf(one), fresh)).toBe('unknown_key_version');
    expect(() => keyringOf(one).open(fresh, AAD)).toThrow('No master key of version 2 is configured');
    expect(failure(rotated, { ...old, keyVersion: 7 })).toBe('unknown_key_version');
  });

  it('keeps its own copy of the keys and refuses a malformed keyring', () => {
    const key = randomBytes(32);
    const keyring = keyringOf(key);
    const sealed = keyring.seal(SECRET, AAD);
    key.fill(0);
    expect(keyring.open(sealed, AAD)).toEqual(SECRET);
    expect(() => keyringOf(randomBytes(16))).toThrow('A master key is 32 bytes');
    expect(() => new Keyring(new Map([[0, randomBytes(32)]]), 0)).toThrow('Key versions start at 1');
    expect(() => new Keyring(new Map([[1, randomBytes(32)]]), 2)).toThrow(
      'The current key version is not in the keyring',
    );
  });

  it('seals JSON values only', () => {
    expect(() => ephemeralKeyring().seal(undefined, AAD)).toThrow('Only a JSON value can be sealed');
  });

  it('never shows a key when it is printed, logged or serialized', () => {
    const key = randomBytes(32);
    const keyring = keyringOf(key);
    const hex = key.toString('hex');
    const base64 = key.toString('base64');
    for (const shown of [
      JSON.stringify(keyring),
      JSON.stringify({ keyring }),
      inspect(keyring),
      String(keyring),
    ]) {
      expect(shown).not.toContain(hex);
      expect(shown).not.toContain(base64);
    }
    expect(JSON.parse(JSON.stringify(keyring))).toEqual({ current: 1, versions: [1] });
    expect(inspect(keyring)).toBe('Keyring { current: 1, versions: [1] }');
  });
});

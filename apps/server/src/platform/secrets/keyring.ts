import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Sealing secrets at rest (S3.1, docs/subscriptions.md): AES-256-GCM under a master key, with a random 12-byte IV per
 * seal, a 16-byte tag, and additional data the caller names (a credential's `credential|<id>|<owner>|<kind>`), so a
 * sealed value moved to another row does not open. A keyring holds the master keys by version and seals with its
 * current one; a sealed value names its version, so a new master key can be added later and old rows still open,
 * with no migration. The keys never leave this object: it seals and opens, nothing else reads them, and it prints as
 * its versions only.
 */

const ALGORITHM = 'aes-256-gcm';
/** AES-256: a key of 32 bytes. */
export const KEY_BYTES = 32;
/** GCM's recommended nonce: 12 bytes, random per seal. */
export const IV_BYTES = 12;
/** The full GCM tag: 16 bytes (a shorter tag is refused when opening). */
export const TAG_BYTES = 16;

/** A sealed value as `credentials` stores it: `key_version`, `iv`, `auth_tag`, `ciphertext`. */
export interface Sealed {
  readonly keyVersion: number;
  readonly iv: Uint8Array;
  readonly tag: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** Why a sealed value did not open: no master key of its version here, or it does not authenticate. */
export type OpenFailure = 'unknown_key_version' | 'unreadable';

/** A sealed value that does not open. Its message names the reason, never any part of the secret or the key. */
export class SecretOpenError extends Error {
  readonly reason: OpenFailure;

  constructor(reason: OpenFailure, keyVersion: number) {
    super(
      reason === 'unknown_key_version'
        ? `No master key of version ${keyVersion} is configured`
        : 'The secret does not open: it was changed, or sealed for another id, owner or kind',
    );
    this.name = 'SecretOpenError';
    this.reason = reason;
  }
}

export class Keyring {
  /** The version new seals use. */
  readonly current: number;
  readonly #keys: ReadonlyMap<number, Buffer>;

  /** The master keys by version (each 32 bytes, versions from 1) and the current one, which must be among them. */
  constructor(keys: ReadonlyMap<number, Uint8Array>, current: number) {
    for (const [version, key] of keys) {
      if (!Number.isInteger(version) || version < 1) throw new RangeError('Key versions start at 1');
      if (key.length !== KEY_BYTES) throw new RangeError(`A master key is ${KEY_BYTES} bytes`);
    }
    if (!keys.has(current)) throw new RangeError('The current key version is not in the keyring');
    // Copies: the caller's arrays may be reused or cleared.
    this.#keys = new Map([...keys].map(([version, key]) => [version, Buffer.from(key)]));
    this.current = current;
  }

  /** The versions this keyring opens, in order. */
  get versions(): number[] {
    return [...this.#keys.keys()].sort((a, b) => a - b);
  }

  /** Seals a JSON value under the current key, with `aad` as additional data. */
  seal(plaintextJson: unknown, aad: string): Sealed {
    const text = JSON.stringify(plaintextJson);
    if (text === undefined) throw new TypeError('Only a JSON value can be sealed');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#keys.get(this.current) as Buffer, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return {
      keyVersion: this.current,
      iv: new Uint8Array(iv),
      tag: new Uint8Array(cipher.getAuthTag()),
      ciphertext: new Uint8Array(ciphertext),
    };
  }

  /**
   * Opens a sealed value with the key of its version and the same additional data. Throws `SecretOpenError` for a
   * version this keyring lacks, and for anything that does not authenticate: a changed ciphertext, IV or tag, or
   * other additional data.
   */
  open(sealed: Sealed, aad: string): unknown {
    const key = this.#keys.get(sealed.keyVersion);
    if (key === undefined) throw new SecretOpenError('unknown_key_version', sealed.keyVersion);
    if (sealed.iv.length !== IV_BYTES || sealed.tag.length !== TAG_BYTES)
      throw new SecretOpenError('unreadable', sealed.keyVersion);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, sealed.iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(sealed.tag);
      const plaintext = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new SecretOpenError('unreadable', sealed.keyVersion);
    }
  }

  /** What a log line or `JSON.stringify` shows of a keyring: its versions, never a key. */
  toJSON(): { current: number; versions: number[] } {
    return { current: this.current, versions: this.versions };
  }

  /** What `console.log` and `util.inspect` show: the same. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Keyring { current: ${this.current}, versions: [${this.versions.join(', ')}] }`;
  }
}

/** A keyring of one master key, version 1 (today's only one: rotation adds versions later). */
export function keyringOf(masterKey: Uint8Array): Keyring {
  return new Keyring(new Map([[1, masterKey]]), 1);
}

/** A keyring with a random key that lives in this process only: for tests and the in-memory demo server. */
export function ephemeralKeyring(): Keyring {
  return keyringOf(randomBytes(KEY_BYTES));
}

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Config, decodeMasterKey } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { ephemeralKeyring, KEY_BYTES, type Keyring, keyringOf } from './keyring.ts';

/**
 * Where the server's master key comes from (S3.1): MWC_MASTER_KEY when it is set (required in production, where the
 * configuration refuses to load without it); in development `.data/master.key` at the repository root, made once
 * (32 random bytes, mode 0600, its folder 0700; `.data/` is git-ignored) and read on every later start, never
 * overwritten; with NODE_ENV=test a key in memory, so no test writes one. The key is never logged or printed: the
 * creation line names the file only.
 */

/** The repository's `.data/` folder, where development keeps its local data. */
export const DEV_DATA_DIR = fileURLToPath(new URL('../../../../../.data/', import.meta.url));

/** The development master key's file name in the data folder. */
export const DEV_KEY_FILE = 'master.key';

/** A master key that cannot be used: none in production, or a key file that is not one. */
export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterKeyError';
  }
}

export interface MasterKeyOptions {
  /** The folder of the development key file; `DEV_DATA_DIR` unless a test names another. */
  readonly dataDir: string;
  /** Says when it made the development key (the file, never the key). */
  readonly logger?: Pick<Logger, 'info'>;
}

type KeyConfig = Pick<Config, 'NODE_ENV' | 'MWC_MASTER_KEY'>;

/** The keyring of MWC_MASTER_KEY, or undefined when it is not set. */
export function envKeyring(config: KeyConfig): Keyring | undefined {
  if (config.MWC_MASTER_KEY === undefined) return undefined;
  const key = decodeMasterKey(config.MWC_MASTER_KEY);
  // The configuration checked it already; this guards a config built by hand.
  if (key === undefined) throw new MasterKeyError('MWC_MASTER_KEY must be the base64 of 32 bytes');
  return keyringOf(key);
}

/** The server's keyring for this configuration: MWC_MASTER_KEY, else the development file, else (tests) memory. */
export async function loadKeyring(config: KeyConfig, options: MasterKeyOptions): Promise<Keyring> {
  const fromEnv = envKeyring(config);
  if (fromEnv) return fromEnv;
  if (config.NODE_ENV === 'production') throw new MasterKeyError('MWC_MASTER_KEY is required in production');
  if (config.NODE_ENV === 'test') return ephemeralKeyring();
  return keyringOf(await devMasterKey(options));
}

/**
 * The development key: made once with an exclusive create (`wx`), so a second start, or two at once, read the first
 * one's key instead of replacing it.
 */
async function devMasterKey(options: MasterKeyOptions): Promise<Uint8Array> {
  const file = join(options.dataDir, DEV_KEY_FILE);
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  try {
    await writeFile(file, key, { flag: 'wx', mode: 0o600 });
    options.logger?.info({ file }, 'created the development master key');
    return new Uint8Array(key);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const existing = await readFile(file);
  if (existing.length !== KEY_BYTES) {
    throw new MasterKeyError(
      `${file} is not a ${KEY_BYTES}-byte key. It is never overwritten: restore it, or move it away to start with a ` +
        'new key (subscriptions sealed under the old one will not open).',
    );
  }
  return new Uint8Array(existing);
}

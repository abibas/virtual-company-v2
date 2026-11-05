import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureLogger } from '@mwc/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEV_DATA_DIR,
  DEV_KEY_FILE,
  envKeyring,
  loadKeyring,
  MasterKeyError,
} from '../../../src/platform/secrets/master-key.ts';

const AAD = 'credential|a|b|gateway';
const SECRET = { headers: { authorization: 'Bearer gw-secret' } };

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    await chmod(folder, 0o700).catch(() => {});
    await rm(folder, { recursive: true, force: true });
  }
});

/** A fresh temporary folder standing in for the repository root; the key's folder is `.data` inside it. */
async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'mwc-master-key-'));
  folders.push(folder);
  return join(folder, '.data');
}

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe('loadKeyring', () => {
  it('takes MWC_MASTER_KEY when it is set, in any environment, as version 1', async () => {
    const key = randomBytes(32).toString('base64');
    const dataDir = await scratch();
    for (const NODE_ENV of ['production', 'development', 'test'] as const) {
      const keyring = await loadKeyring({ NODE_ENV, MWC_MASTER_KEY: key }, { dataDir });
      expect(keyring.versions).toEqual([1]);
      const again = envKeyring({ NODE_ENV, MWC_MASTER_KEY: key });
      expect(again?.open(keyring.seal(SECRET, AAD), AAD)).toEqual(SECRET);
    }
    expect(existsSync(dataDir)).toBe(false);
  });

  it('refuses to run production without MWC_MASTER_KEY, and never makes a key file there', async () => {
    const dataDir = await scratch();
    const failure = loadKeyring({ NODE_ENV: 'production', MWC_MASTER_KEY: undefined }, { dataDir });
    await expect(failure).rejects.toBeInstanceOf(MasterKeyError);
    await expect(failure).rejects.toThrow('MWC_MASTER_KEY is required in production');
    expect(existsSync(dataDir)).toBe(false);
  });

  it('keeps a test key in memory: no file is written', async () => {
    const dataDir = await scratch();
    const keyring = await loadKeyring({ NODE_ENV: 'test', MWC_MASTER_KEY: undefined }, { dataDir });
    expect(keyring.open(keyring.seal(SECRET, AAD), AAD)).toEqual(SECRET);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('makes the development key once (32 bytes, 0600 in a 0700 folder), reads it later and never overwrites it', async () => {
    const dataDir = await scratch();
    const { logger, lines } = captureLogger();
    const dev = { NODE_ENV: 'development', MWC_MASTER_KEY: undefined } as const;
    const first = await loadKeyring(dev, { dataDir, logger });
    const file = join(dataDir, DEV_KEY_FILE);
    const bytes = await readFile(file);
    expect(bytes).toHaveLength(32);
    expect(await mode(file)).toBe(0o600);
    expect(await mode(dataDir)).toBe(0o700);
    expect(lines.map((line) => [line.msg, line.file])).toEqual([
      ['created the development master key', file],
    ]);
    // The line names the file, never the key.
    expect(JSON.stringify(lines)).not.toContain(bytes.toString('base64'));
    expect(JSON.stringify(lines)).not.toContain(bytes.toString('hex'));

    const sealed = first.seal(SECRET, AAD);
    const second = await loadKeyring(dev, { dataDir, logger });
    expect(second.open(sealed, AAD)).toEqual(SECRET);
    expect((await readFile(file)).equals(bytes)).toBe(true);
    expect(lines).toHaveLength(1);
  });

  it('refuses a key file that is not 32 bytes, and leaves it as it is', async () => {
    const dataDir = await scratch();
    const dev = { NODE_ENV: 'development', MWC_MASTER_KEY: undefined } as const;
    await loadKeyring(dev, { dataDir });
    const file = join(dataDir, DEV_KEY_FILE);
    await writeFile(file, 'not a key\n');
    const failure = loadKeyring(dev, { dataDir });
    await expect(failure).rejects.toBeInstanceOf(MasterKeyError);
    await expect(failure).rejects.toThrow(/is not a 32-byte key\. It is never overwritten/);
    expect(await readFile(file, 'utf8')).toBe('not a key\n');
  });

  it('passes on a failure to write the key file other than finding one there', async () => {
    const dataDir = await scratch();
    await loadKeyring({ NODE_ENV: 'development', MWC_MASTER_KEY: undefined }, { dataDir });
    await rm(join(dataDir, DEV_KEY_FILE));
    await chmod(dataDir, 0o500);
    const failure = loadKeyring({ NODE_ENV: 'development', MWC_MASTER_KEY: undefined }, { dataDir });
    await expect(failure).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('has no keyring without MWC_MASTER_KEY, and refuses one built by hand that is not a key', () => {
    expect(envKeyring({ NODE_ENV: 'development', MWC_MASTER_KEY: undefined })).toBeUndefined();
    expect(() => envKeyring({ NODE_ENV: 'production', MWC_MASTER_KEY: 'short' })).toThrow(MasterKeyError);
  });

  it("keeps the development key in the repository's .data folder", () => {
    expect(DEV_DATA_DIR.endsWith('/.data/')).toBe(true);
    expect(existsSync(join(DEV_DATA_DIR, '..', 'pnpm-workspace.yaml'))).toBe(true);
  });
});

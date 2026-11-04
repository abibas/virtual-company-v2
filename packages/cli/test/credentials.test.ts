import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CredentialsError,
  configDir,
  credentialsPath,
  EMPTY_CREDENTIALS,
  normalizeServer,
  readCredentials,
  removeLogin,
  resolveLogin,
  type SavedLogin,
  saveLogin,
  writeCredentials,
} from '../src/credentials.ts';
import { ACME, KEY, OTHER_KEY, REMOTE, SERVER, tempConfig } from './fixtures/account.ts';

const mode = (path: string) => statSync(path).mode & 0o777;
const login = (server = SERVER, key = KEY): SavedLogin => ({
  server,
  companyId: ACME.companyId,
  companySlug: ACME.slug,
  key,
});

describe('where the credentials live', () => {
  it('is MWC_CONFIG_DIR, else $XDG_CONFIG_HOME/mwc, else ~/.config/mwc', () => {
    expect(configDir({ MWC_CONFIG_DIR: '/tmp/x', XDG_CONFIG_HOME: '/xdg' })).toBe('/tmp/x');
    expect(configDir({ XDG_CONFIG_HOME: '/xdg', HOME: '/home/o' })).toBe('/xdg/mwc');
    expect(configDir({ HOME: '/home/o' })).toBe('/home/o/.config/mwc');
    expect(configDir({})).toBe(join(homedir(), '.config', 'mwc'));
    expect(credentialsPath({ MWC_CONFIG_DIR: '/tmp/x' })).toBe('/tmp/x/credentials.json');
  });
});

describe('normalizeServer', () => {
  it.each([
    ['http://localhost:9950', 'http://localhost:9950'],
    ['http://localhost:9950/', 'http://localhost:9950'],
    [' HTTPS://Corp.Example.com/ ', 'https://corp.example.com'],
    ['https://corp.example.com/mwc//', 'https://corp.example.com/mwc'],
    ['https://corp.example.com:443', 'https://corp.example.com'],
  ])('keys %j as %j', (raw, server) => {
    expect(normalizeServer(raw)).toBe(server);
  });

  it.each([
    ['localhost:9950', /must start with http/],
    ['ftp://corp.example.com', /must start with http/],
    ['not a url', /is not a server URL/],
    ['https://olga:pw@corp.example.com', /no user, password, query or fragment/],
    ['https://corp.example.com/?a=1', /no user, password, query or fragment/],
    ['https://corp.example.com/#top', /no user, password, query or fragment/],
  ])('refuses %j', (raw, message) => {
    expect(() => normalizeServer(raw)).toThrow(CredentialsError);
    expect(() => normalizeServer(raw)).toThrow(message);
  });
});

describe('readCredentials', () => {
  it('reads nothing saved yet as no logins', () => {
    expect(readCredentials(tempConfig().path)).toEqual(EMPTY_CREDENTIALS);
  });

  it('reads the saved logins and the current server', () => {
    const { path, dir } = tempConfig();
    mkdirSync(dir);
    writeFileSync(path, JSON.stringify({ version: 1, servers: { [SERVER]: login() } }));
    expect(readCredentials(path)).toEqual({ version: 1, servers: { [SERVER]: login() } });
    writeFileSync(path, JSON.stringify({ version: 1, current: SERVER, servers: { [SERVER]: login() } }));
    expect(readCredentials(path).current).toBe(SERVER);
  });

  it.each([
    ['{', /is not valid JSON/],
    ['null', /is not an mwc credentials file/],
    ['{"version":2,"servers":{}}', /is not an mwc credentials file/],
    ['{"version":1}', /is not an mwc credentials file/],
    ['{"version":1,"servers":{"x":{"server":"x","key":"k"}}}', /has a login without/],
  ])('refuses a file that is not ours: %j', (text, message) => {
    const { path, dir } = tempConfig();
    mkdirSync(dir);
    writeFileSync(path, text);
    expect(() => readCredentials(path)).toThrow(message);
  });

  it('says why a file cannot be read', () => {
    const { path } = tempConfig();
    mkdirSync(path, { recursive: true });
    expect(() => readCredentials(path)).toThrow(/cannot read .*credentials\.json/);
  });
});

describe('writeCredentials', () => {
  it('writes the file 0600 in a folder 0700, and makes an existing folder 0700', () => {
    const { path, dir } = tempConfig();
    writeCredentials(path, { version: 1, current: SERVER, servers: { [SERVER]: login() } });
    expect(mode(dir)).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 1,
      current: SERVER,
      servers: { [SERVER]: login() },
    });
    chmodSync(dir, 0o755);
    chmodSync(path, 0o644);
    writeCredentials(path, EMPTY_CREDENTIALS);
    expect(mode(dir)).toBe(0o700);
    expect(mode(path)).toBe(0o600);
  });

  it('replaces the file by renaming a new one over it, leaving no temporary file behind', () => {
    const { path, dir } = tempConfig();
    writeCredentials(path, EMPTY_CREDENTIALS);
    const before = statSync(path).ino;
    const renames: [string, string][] = [];
    writeCredentials(
      path,
      { version: 1, servers: { [SERVER]: login() } },
      {
        rename: (from, to) => {
          renames.push([from, to]);
          // Until the rename, the old file is untouched and the new content sits in the temporary file, 0600.
          expect(readCredentials(to)).toEqual(EMPTY_CREDENTIALS);
          expect(mode(from)).toBe(0o600);
          expect(JSON.parse(readFileSync(from, 'utf8')).servers[SERVER]).toEqual(login());
          renameSync(from, to);
        },
      },
    );
    expect(renames).toHaveLength(1);
    expect(renames[0]?.[0]).toMatch(new RegExp(`^${dir}/\\.credentials\\.\\d+\\.[0-9a-f]{12}\\.tmp$`));
    expect(statSync(path).ino).not.toBe(before);
    expect(readdirSync(dir)).toEqual(['credentials.json']);
  });

  it('keeps the old file and removes the temporary one when the write fails', () => {
    const { path, dir } = tempConfig();
    saveLogin(path, login());
    const failing = () => {
      throw new Error('disk full');
    };
    expect(() => saveLogin(path, login(REMOTE, OTHER_KEY), { rename: failing })).toThrow('disk full');
    expect(readCredentials(path)).toEqual({ version: 1, current: SERVER, servers: { [SERVER]: login() } });
    expect(readdirSync(dir)).toEqual(['credentials.json']);
  });
});

describe('saveLogin and removeLogin', () => {
  it("saves one login per server, replaces a server's login and makes the last one current", () => {
    const { path } = tempConfig();
    saveLogin(path, login());
    saveLogin(path, login(REMOTE));
    saveLogin(path, login(SERVER, OTHER_KEY));
    expect(readCredentials(path)).toEqual({
      version: 1,
      current: SERVER,
      servers: { [SERVER]: login(SERVER, OTHER_KEY), [REMOTE]: login(REMOTE) },
    });
  });

  it('removes a login, moving the current server to another saved one, then to none', () => {
    const { path } = tempConfig();
    expect(removeLogin(path, SERVER)).toBe(false);
    saveLogin(path, login());
    saveLogin(path, login(REMOTE));
    expect(removeLogin(path, SERVER)).toBe(true);
    expect(readCredentials(path)).toEqual({
      version: 1,
      current: REMOTE,
      servers: { [REMOTE]: login(REMOTE) },
    });
    saveLogin(path, login());
    expect(removeLogin(path, REMOTE)).toBe(true);
    expect(readCredentials(path).current).toBe(SERVER);
    expect(removeLogin(path, SERVER)).toBe(true);
    expect(readCredentials(path)).toEqual(EMPTY_CREDENTIALS);
  });
});

describe('resolveLogin', () => {
  const file = {
    version: 1 as const,
    current: SERVER,
    servers: { [SERVER]: login(), [REMOTE]: login(REMOTE, OTHER_KEY) },
  };

  it('uses the current saved login when nothing else is said', () => {
    expect(resolveLogin({}, file)).toEqual({ server: SERVER, key: KEY, source: 'file', saved: login() });
  });

  it('takes the server from --server, then MWC_SERVER, then the file', () => {
    expect(resolveLogin({ MWC_SERVER: SERVER }, file, `${REMOTE}/`)).toMatchObject({
      server: REMOTE,
      key: OTHER_KEY,
    });
    expect(resolveLogin({ MWC_SERVER: REMOTE }, file)).toMatchObject({ server: REMOTE, key: OTHER_KEY });
  });

  it('takes MWC_API_KEY over the saved key, without the saved company', () => {
    expect(resolveLogin({ MWC_API_KEY: ` ${OTHER_KEY} ` }, file)).toEqual({
      server: SERVER,
      key: OTHER_KEY,
      source: 'env',
    });
    expect(
      resolveLogin({ MWC_SERVER: 'https://other.example.com', MWC_API_KEY: KEY }, EMPTY_CREDENTIALS),
    ).toEqual({
      server: 'https://other.example.com',
      key: KEY,
      source: 'env',
    });
  });

  it('is undefined without a server, or without a key for it', () => {
    expect(resolveLogin({}, EMPTY_CREDENTIALS)).toBeUndefined();
    expect(resolveLogin({ MWC_API_KEY: KEY }, EMPTY_CREDENTIALS)).toBeUndefined();
    expect(resolveLogin({ MWC_SERVER: 'https://other.example.com' }, file)).toBeUndefined();
    expect(resolveLogin({ MWC_SERVER: '' }, file)).toMatchObject({ server: SERVER });
  });
});

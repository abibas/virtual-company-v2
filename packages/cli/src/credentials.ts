/**
 * The saved logins of `mwc login` (`~/.config/mwc/credentials.json`), which `mwc whoami`, `mwc logout` and (S2.6)
 * `@mwc/mcp` read: one personal API key per server, the file 0600 in a 0700 folder, written atomically. Exported as
 * `@mwc/cli/credentials`. `MWC_CONFIG_DIR` moves the folder (tests always set it); `MWC_SERVER` and `MWC_API_KEY`
 * take precedence over the file (`resolveLogin`).
 */
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** One server's login: which company the key belongs to, and the key itself. */
export interface SavedLogin {
  readonly server: string;
  readonly companyId: string;
  readonly companySlug: string;
  readonly key: string;
}

export interface CredentialsFile {
  readonly version: 1;
  /** The server of the last login: what `whoami` and `logout` use when no server is named. */
  readonly current?: string;
  /** By server (`normalizeServer`). */
  readonly servers: Readonly<Record<string, SavedLogin>>;
}

type Env = Readonly<Record<string, string | undefined>>;

/** A credentials file that cannot be read, or a server address that is not one. */
export class CredentialsError extends Error {
  override readonly name = 'CredentialsError';
}

export const EMPTY_CREDENTIALS: CredentialsFile = { version: 1, servers: {} };

/** The folder: `MWC_CONFIG_DIR`, else `$XDG_CONFIG_HOME/mwc`, else `~/.config/mwc`. */
export function configDir(env: Env): string {
  if (env.MWC_CONFIG_DIR) return env.MWC_CONFIG_DIR;
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'mwc');
}

export const credentialsPath = (env: Env) => join(configDir(env), 'credentials.json');

/**
 * A server address as logins are keyed by: an http(s) URL without credentials, query or fragment, kept as its origin
 * and path without a trailing slash (`http://localhost:9950`).
 */
export function normalizeServer(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CredentialsError(
      `${JSON.stringify(raw)} is not a server URL (for example http://localhost:9950)`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CredentialsError(`the server URL must start with http:// or https://, not ${url.protocol}//`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CredentialsError('the server URL takes no user, password, query or fragment');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const isLogin = (value: unknown): value is SavedLogin =>
  typeof value === 'object' &&
  value !== null &&
  ['server', 'companyId', 'companySlug', 'key'].every(
    (field) => typeof (value as Record<string, unknown>)[field] === 'string',
  );

/** The saved logins; none when the file does not exist yet. A file that is not ours is an error, never overwritten. */
export function readCredentials(path: string): CredentialsFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_CREDENTIALS;
    throw new CredentialsError(`cannot read ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CredentialsError(`${path} is not valid JSON; fix it or delete it and log in again`);
  }
  const file = parsed as Partial<CredentialsFile> | null;
  const servers = file?.servers;
  if (file?.version !== 1 || typeof servers !== 'object' || servers === null) {
    throw new CredentialsError(`${path} is not an mwc credentials file (version 1); fix it or delete it`);
  }
  if (!Object.values(servers).every(isLogin)) {
    throw new CredentialsError(`${path} has a login without server, companyId, companySlug or key`);
  }
  return typeof file.current === 'string'
    ? { version: 1, current: file.current, servers }
    : { version: 1, servers };
}

export interface WriteOptions {
  /** The final step, `rename(tmp, path)`; injectable so a test can fail it. */
  readonly rename?: (from: string, to: string) => void;
}

/**
 * Writes the file atomically: the folder is made (or kept) 0700, the JSON goes to a new temporary file 0600 in the
 * same folder, is flushed to disk, then renamed over the old file, so a reader sees the old file or the new one,
 * never half of one. On a failure the temporary file is removed and the old file stays as it was.
 */
export function writeCredentials(path: string, file: CredentialsFile, options: WriteOptions = {}): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.credentials.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, `${JSON.stringify(file, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    (options.rename ?? renameSync)(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Saves a login (replacing the server's earlier one) and makes its server the current one. */
export function saveLogin(path: string, login: SavedLogin, options: WriteOptions = {}): void {
  const file = readCredentials(path);
  writeCredentials(
    path,
    { version: 1, current: login.server, servers: { ...file.servers, [login.server]: login } },
    options,
  );
}

/** Removes the server's login; false when there was none. The current server moves to another saved one, if any. */
export function removeLogin(path: string, server: string): boolean {
  const file = readCredentials(path);
  if (file.servers[server] === undefined) return false;
  const { [server]: _removed, ...servers } = file.servers;
  const current = file.current === server ? Object.keys(servers)[0] : file.current;
  writeCredentials(path, current === undefined ? { version: 1, servers } : { version: 1, current, servers });
  return true;
}

/** The login a command uses, and where its key came from. */
export interface ActiveLogin {
  readonly server: string;
  readonly key: string;
  readonly source: 'env' | 'file';
  /** The saved login of that server, when the key came from the file. */
  readonly saved?: SavedLogin;
}

/**
 * Which server and key to use: the server named (`--server`), else `MWC_SERVER`, else the current one in the file;
 * the key `MWC_API_KEY`, else the one saved for that server. Undefined when there is no server or no key.
 */
export function resolveLogin(env: Env, file: CredentialsFile, named?: string): ActiveLogin | undefined {
  const raw = named ?? (env.MWC_SERVER || file.current);
  if (raw === undefined) return undefined;
  const server = normalizeServer(raw);
  if (env.MWC_API_KEY) return { server, key: env.MWC_API_KEY.trim(), source: 'env' };
  const saved = file.servers[server];
  return saved === undefined ? undefined : { server, key: saved.key, source: 'file', saved };
}

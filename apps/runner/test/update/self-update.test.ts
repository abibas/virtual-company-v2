import { describe, expect, it } from 'vitest';
import type { UpdateTarget } from '../../src/update/build.ts';
import { selfUpdater, UpdateError } from '../../src/update/self-update.ts';
import { type Download, fakeDownloads, memoryFs, ptyArchive, sha } from '../fixtures/update.ts';

const DIR = '/home/ihor/.local/share/mwc-runner';
const BUNDLE = `${DIR}/runner.mjs`;
const OLD_PTY = `${DIR}/node_modules/@lydell/node-pty-linux-arm64/package.json`;
const NEW_PTY = `${DIR}/node_modules/@lydell/node-pty-linux-arm64/prebuilds/spawn-helper`;
const TARGET: UpdateTarget = { manager: 'systemd', bundle: BUNDLE, pty: 'linux-arm64' };
const SERVER = 'http://127.0.0.1:9950';
const RUNNER = '/api/runner/runner.mjs';
const PTY = '/api/runner/pty/linux-arm64.tgz';
const MANIFEST = '/api/runner/runner.json';
const SIDECAR = `${DIR}/runner.json`;
const OLD_JSON = '{"builtAt":"2026-11-09T16:56:00.000Z"}';
const NEW_JSON = '{"builtAt":"2026-11-09T17:21:00.000Z"}';

/** The installed copy: the old bundle, its manifest and the old PTY. */
const installed = () => memoryFs({ [BUNDLE]: '// old', [SIDECAR]: OLD_JSON, [OLD_PTY]: '{"version":"old"}' });

function updater(downloads: Record<string, Download>, files = installed(), target = TARGET) {
  const server = fakeDownloads(downloads);
  const update = selfUpdater({ target, fetch: server.fetch, fs: files.fs, tag: () => 't1' });
  return { update, files, urls: server.urls };
}

/** What `apply` rejected with: the UpdateError's code and message. */
async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(UpdateError);
  return { code: (error as UpdateError).code, message: (error as UpdateError).message };
}

/** The old copy, untouched, and nothing left over. */
function expectOldCopy(files: ReturnType<typeof installed>) {
  expect(files.paths()).toEqual([BUNDLE, SIDECAR, OLD_PTY].sort());
  expect([files.text(BUNDLE), files.text(SIDECAR), files.text(OLD_PTY)]).toEqual([
    '// old',
    OLD_JSON,
    '{"version":"old"}',
  ]);
}

describe('the self-update', () => {
  it('downloads the runner, its manifest and its PTY from its server, checks them and puts them in place', async () => {
    const { update, files, urls } = updater({
      [RUNNER]: { body: '// new' },
      [MANIFEST]: { body: NEW_JSON },
      [PTY]: { body: ptyArchive() },
    });
    expect(update.manager).toBe('systemd');
    expect(await update.apply(`${SERVER}/`)).toEqual({ build: sha('// new'), pty: true });
    expect(urls).toEqual([`${SERVER}${RUNNER}`, `${SERVER}${MANIFEST}`, `${SERVER}${PTY}`]);
    expect(files.text(BUNDLE)).toBe('// new');
    expect(files.text(SIDECAR)).toBe(NEW_JSON);
    expect(files.mode(SIDECAR)).toBe(0o644);
    expect(files.text(OLD_PTY)).toBe('{"version":"new"}');
    expect(files.mode(NEW_PTY)).toBe(0o755);
    expect(files.mode(BUNDLE)).toBe(0o644);
    expect(files.paths()).toEqual([OLD_PTY, NEW_PTY, SIDECAR, BUNDLE].sort());
  });

  it('replaces atomically: everything written aside first, the old PTY and manifest moved away, the new ones in, then the bundle', async () => {
    const { update, files } = updater({
      [RUNNER]: { body: '// new' },
      [MANIFEST]: { body: NEW_JSON },
      [PTY]: { body: ptyArchive() },
    });
    await update.apply(SERVER);
    expect(files.ops.filter((op) => !op.startsWith('mkdir'))).toEqual([
      `writeBytes ${DIR}/.runner.t1.tmp`,
      `writeBytes ${DIR}/.runner-json.t1.tmp`,
      `writeBytes ${DIR}/.update.t1/node_modules/@lydell/node-pty-linux-arm64/package.json`,
      `writeBytes ${DIR}/.update.t1/node_modules/@lydell/node-pty-linux-arm64/prebuilds/spawn-helper`,
      `rename ${DIR}/node_modules`,
      `rename ${DIR}/.update.t1/node_modules`,
      `rename ${DIR}/runner.json`,
      `rename ${DIR}/.runner-json.t1.tmp`,
      `rename ${DIR}/.runner.t1.tmp`,
      `remove ${DIR}/.update.t1`,
      `remove ${DIR}/.node_modules.t1.old`,
      `remove ${DIR}/.runner-json.t1.old`,
    ]);
  });

  it('leaves no manifest from a server without one (an old one would tell a wrong build time)', async () => {
    const { update, files, urls } = updater({ [RUNNER]: { body: '// new' } });
    await update.apply(SERVER);
    expect(urls).toContain(`${SERVER}${MANIFEST}`);
    expect(files.text(BUNDLE)).toBe('// new');
    expect(files.text(SIDECAR)).toBeUndefined();
    expect(files.paths()).toEqual([BUNDLE, OLD_PTY].sort());
  });

  it('refuses a manifest that does not match its SHA-256, and keeps the old copy', async () => {
    const { update, files } = updater({
      [RUNNER]: { body: '// new' },
      [MANIFEST]: { body: NEW_JSON, sha: sha(OLD_JSON) },
    });
    expect(await refusal(update.apply(SERVER))).toMatchObject({
      code: 'hash_mismatch',
      message: expect.stringContaining("the runner's manifest does not match its SHA-256"),
    });
    expectOldCopy(files);
  });

  it('reads a ws server address as http, and a ws one with TLS as https', async () => {
    const { update, urls } = updater({ [RUNNER]: { body: '// new' } }, installed(), {
      ...TARGET,
      pty: undefined,
    });
    await update.apply('wss://corp.example.test');
    expect(urls).toEqual([`https://corp.example.test${RUNNER}`, `https://corp.example.test${MANIFEST}`]);
  });

  it('refuses a runner that does not match its SHA-256, or comes without one, and keeps the old copy', async () => {
    const mismatch = updater({
      [RUNNER]: { body: '// new', sha: sha('// other') },
      [PTY]: { body: ptyArchive() },
    });
    expect(await refusal(mismatch.update.apply(SERVER))).toEqual({
      code: 'hash_mismatch',
      message: `the runner does not match its SHA-256 (${sha('// new')}, expected ${sha('// other')})`,
    });
    expectOldCopy(mismatch.files);
    const unsigned = updater({ [RUNNER]: { body: '// new', sha: null } });
    expect(await refusal(unsigned.update.apply(SERVER))).toEqual({
      code: 'hash_mismatch',
      message: 'the server sent no SHA-256 for the runner',
    });
    expectOldCopy(unsigned.files);
  });

  it("refuses a PTY that does not match its SHA-256, and keeps the old copy's runner and PTY", async () => {
    const { update, files } = updater({
      [RUNNER]: { body: '// new' },
      [PTY]: { body: ptyArchive(), sha: 'ab'.repeat(32) },
    });
    expect((await refusal(update.apply(SERVER))).code).toBe('hash_mismatch');
    expectOldCopy(files);
  });

  it('says why a download failed: a server without the runner built, or one that cannot be reached', async () => {
    const missing = updater({});
    expect(await refusal(missing.update.apply(SERVER))).toEqual({
      code: 'download_failed',
      message: `cannot download the runner from ${SERVER}${RUNNER}: the server answered 404`,
    });
    const files = installed();
    const update = selfUpdater({
      target: TARGET,
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
      fs: files.fs,
    });
    expect((await refusal(update.apply(SERVER))).message).toContain('connect ECONNREFUSED');
    expectOldCopy(files);
  });

  it('keeps the PTY it has when the server has none for its system, or when none is built for it', async () => {
    const without = updater({ [RUNNER]: { body: '// new' } });
    expect(await without.update.apply(SERVER)).toEqual({ build: sha('// new'), pty: false });
    expect([without.files.text(BUNDLE), without.files.text(OLD_PTY)]).toEqual([
      '// new',
      '{"version":"old"}',
    ]);
    const other = updater({ [RUNNER]: { body: '// new' } }, installed(), { ...TARGET, pty: undefined });
    expect((await other.update.apply(SERVER)).pty).toBe(false);
    expect(other.urls).toEqual([`${SERVER}${RUNNER}`, `${SERVER}${MANIFEST}`]);
  });

  it('puts a PTY in place where there was none', async () => {
    const files = memoryFs({ [BUNDLE]: '// old' });
    const { update } = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: ptyArchive() } }, files);
    await update.apply(SERVER);
    expect(files.text(OLD_PTY)).toBe('{"version":"new"}');
  });

  it('refuses a PTY archive it cannot read, or one not laid out as node_modules/', async () => {
    const broken = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: 'not gzip' } });
    expect(await refusal(broken.update.apply(SERVER))).toMatchObject({
      code: 'download_failed',
      message: expect.stringContaining("cannot read the terminal's archive"),
    });
    expectOldCopy(broken.files);
    const { tarGz } = await import('../../src/install/tar.ts');
    const elsewhere = tarGz([{ path: 'etc/passwd', mode: 0o644, body: Buffer.from('x') }]);
    const odd = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: elsewhere } });
    expect((await refusal(odd.update.apply(SERVER))).message).toBe(
      "the terminal's archive is not laid out as node_modules/",
    );
    expectOldCopy(odd.files);
  });

  it('keeps the old copy when the new files cannot be written, and removes what it wrote', async () => {
    const files = installed();
    files.failWhen((op, path) => op === 'writeBytes' && path.endsWith('spawn-helper'));
    const { update } = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: ptyArchive() } }, files);
    expect(await refusal(update.apply(SERVER))).toMatchObject({
      code: 'write_failed',
      message: expect.stringContaining(`cannot put the new runner in ${DIR}: EIO`),
    });
    expectOldCopy(files);
  });

  it('puts the old PTY and manifest back when the bundle cannot be renamed into place', async () => {
    const files = installed();
    files.failWhen((op, path) => op === 'rename' && path.endsWith('.runner.t1.tmp'));
    const downloads = {
      [RUNNER]: { body: '// new' },
      [MANIFEST]: { body: NEW_JSON },
      [PTY]: { body: ptyArchive() },
    };
    const { update } = updater(downloads, files);
    expect((await refusal(update.apply(SERVER))).code).toBe('write_failed');
    expectOldCopy(files);
  });

  it('goes on when the old PTY cannot be put back or the leftovers cannot be removed', async () => {
    const files = installed();
    files.failWhen(
      (op, path) =>
        (op === 'rename' && (path.endsWith('.runner.t1.tmp') || path.endsWith('.old'))) ||
        (op === 'remove' && path.endsWith('.update.t1')),
    );
    const { update } = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: ptyArchive() } }, files);
    expect((await refusal(update.apply(SERVER))).code).toBe('write_failed');
    expect(files.text(BUNDLE)).toBe('// old');
    expect(files.text(`${DIR}/.node_modules.t1.old/@lydell/node-pty-linux-arm64/package.json`)).toBe(
      '{"version":"old"}',
    );
  });

  it('puts nothing back when there was no PTY before a failed rename, and says why a fetch failed without an Error', async () => {
    const files = memoryFs({ [BUNDLE]: '// old' });
    files.failWhen((op, path) => op === 'rename' && path.endsWith('.runner.t1.tmp'));
    const { update } = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: ptyArchive() } }, files);
    expect((await refusal(update.apply(SERVER))).code).toBe('write_failed');
    expect(files.paths()).toEqual([BUNDLE]);
    const odd = selfUpdater({ target: TARGET, fetch: () => Promise.reject('offline'), fs: installed().fs });
    expect((await refusal(odd.apply(SERVER))).message).toMatch(/: offline$/);
  });

  it('gives a file the archive says has no mode the usual 0644', async () => {
    const { tarGz } = await import('../../src/install/tar.ts');
    const modeless = tarGz([
      { path: 'node_modules/@lydell/node-pty-linux-arm64/package.json', mode: 0, body: Buffer.from('{}') },
    ]);
    const { update, files } = updater({ [RUNNER]: { body: '// new' }, [PTY]: { body: modeless } });
    await update.apply(SERVER);
    expect(files.mode(OLD_PTY)).toBe(0o644);
  });

  it('makes its own random names when not given a tag', async () => {
    const files = installed();
    const server = fakeDownloads({ [RUNNER]: { body: '// new' } });
    const update = selfUpdater({ target: { ...TARGET, pty: undefined }, fetch: server.fetch, fs: files.fs });
    await update.apply(SERVER);
    expect(files.ops[0]).toMatch(/^writeBytes .*\/\.runner\.[0-9a-f]{12}\.tmp$/);
  });
});

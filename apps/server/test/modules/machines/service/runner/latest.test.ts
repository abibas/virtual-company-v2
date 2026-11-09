import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { latestRunner, manifestPath } from '../../../../../src/modules/machines/service/runner/latest.ts';

const SHA = 'cd'.repeat(32);
const manifest = (version: string, builtAt: string) => JSON.stringify({ version, builtAt, sha256: SHA });

/** A folder with a bundle in it, and the path of its manifest. */
function built(): { bundle: string; manifest: string } {
  const bundle = join(mkdtempSync(join(tmpdir(), 'mwc-latest-')), 'runner.mjs');
  writeFileSync(bundle, '// the runner\n');
  return { bundle, manifest: manifestPath(bundle) };
}

describe('the latest runner this server hands out', () => {
  it('is read from runner.json beside the bundle', async () => {
    const { bundle, manifest: path } = built();
    expect(path).toBe(join(bundle, '..', 'runner.json'));
    writeFileSync(path, manifest('0.5.0', '2026-11-09T16:40:00.000Z'));
    expect(await latestRunner(bundle)).toEqual({
      version: '0.5.0',
      builtAt: '2026-11-09T16:40:00.000Z',
      build: SHA,
    });
  });

  it('is null while the manifest or the bundle is missing, or the manifest does not parse', async () => {
    const { bundle, manifest: path } = built();
    expect(await latestRunner(bundle)).toBeNull();
    writeFileSync(path, '{ not json');
    expect(await latestRunner(bundle)).toBeNull();
    writeFileSync(path, manifest('v0.5', '2026-11-09T16:40:00.000Z'));
    utimesSync(path, new Date(1_000_000), new Date(1_000_000));
    expect(await latestRunner(bundle)).toBeNull();
    writeFileSync(path, manifest('0.5.0', '2026-11-09T16:40:00.000Z'));
    rmSync(bundle);
    expect(await latestRunner(bundle)).toBeNull();
  });

  it('is read again only when the manifest changed (its time or size)', async () => {
    const { bundle, manifest: path } = built();
    const at = new Date('2026-11-09T16:40:00.000Z');
    writeFileSync(path, manifest('0.5.0', '2026-11-09T16:40:00.000Z'));
    utimesSync(path, at, at);
    expect((await latestRunner(bundle))?.builtAt).toBe('2026-11-09T16:40:00.000Z');
    // Same size and time: the cached one, even though the text changed.
    writeFileSync(path, manifest('0.5.0', '2026-11-09T17:05:00.000Z'));
    utimesSync(path, at, at);
    expect((await latestRunner(bundle))?.builtAt).toBe('2026-11-09T16:40:00.000Z');
    // A rebuild moves its time: read again.
    const later = new Date('2026-11-09T17:05:00.000Z');
    utimesSync(path, later, later);
    expect((await latestRunner(bundle))?.builtAt).toBe('2026-11-09T17:05:00.000Z');
  });
});

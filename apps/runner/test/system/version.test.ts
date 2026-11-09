import { afterEach, describe, expect, it } from 'vitest';
import { RUNNER_MANIFEST_FILE, runnerBuiltAt, runnerVersion } from '../../src/system/version.ts';

const global = globalThis as { MWC_RUNNER_VERSION?: unknown };

afterEach(() => {
  delete global.MWC_RUNNER_VERSION;
});

describe("the runner's version", () => {
  it('reads it from package.json when run from the sources', () => {
    expect(runnerVersion(() => '0.1.0')).toBe('0.1.0');
  });

  it('takes the one built into the bundle without reading anything', () => {
    // esbuild replaces the constant with the version's text; a global of that name stands in for it here.
    global.MWC_RUNNER_VERSION = '1.2.3';
    expect(
      runnerVersion(() => {
        throw new Error('read');
      }),
    ).toBe('1.2.3');
  });
});

describe("the runner's build time", () => {
  const BUNDLE = '/opt/mwc-runner/runner.mjs';
  /** Reads only the manifest beside the bundle, with `text` in it (undefined: missing). */
  const beside = (text: string | undefined) => (path: string) => {
    expect(path).toBe(`/opt/mwc-runner/${RUNNER_MANIFEST_FILE}`);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };

  it('is the builtAt of the runner.json beside the bundle it runs', () => {
    const manifest = '{"version":"0.5.0","builtAt":"2026-11-09T16:56:00.000Z","sha256":"ab"}';
    expect(runnerBuiltAt(BUNDLE, beside(manifest))).toBe('2026-11-09T16:56:00.000Z');
  });

  it('is null without a runner.json there, or with one that is garbled or says no valid time', () => {
    expect(runnerBuiltAt(BUNDLE, beside(undefined))).toBeNull();
    expect(runnerBuiltAt(BUNDLE, beside('{not json'))).toBeNull();
    expect(runnerBuiltAt(BUNDLE, beside('null'))).toBeNull();
    expect(runnerBuiltAt(BUNDLE, beside('{"builtAt":"yesterday"}'))).toBeNull();
    expect(runnerBuiltAt(BUNDLE, beside('{"version":"0.5.0"}'))).toBeNull();
  });

  it('is null from the sources, without reading anything', () => {
    const read = () => {
      throw new Error('read');
    };
    expect(runnerBuiltAt('/repo/apps/runner/src/main.ts', read)).toBeNull();
  });
});

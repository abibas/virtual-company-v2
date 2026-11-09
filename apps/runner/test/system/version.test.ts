import { afterEach, describe, expect, it } from 'vitest';
import { runnerBuiltAt, runnerVersion } from '../../src/system/version.ts';

const global = globalThis as { MWC_RUNNER_VERSION?: unknown; MWC_RUNNER_BUILT_AT?: unknown };

afterEach(() => {
  delete global.MWC_RUNNER_VERSION;
  delete global.MWC_RUNNER_BUILT_AT;
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
  it('is null from the sources', () => {
    expect(runnerBuiltAt()).toBeNull();
  });

  it('is the one stamped into the bundle', () => {
    global.MWC_RUNNER_BUILT_AT = '2026-11-09T16:40:00.000Z';
    expect(runnerBuiltAt()).toBe('2026-11-09T16:40:00.000Z');
  });
});

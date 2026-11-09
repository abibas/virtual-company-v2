import { describe, expect, it } from 'vitest';
import { RunnerHello } from '../../src/runner-protocol/runner-frames.ts';
import {
  RUNNER_UPDATE_ERRORS,
  RunnerBuild,
  RunnerUpdate,
  RunnerUpdateResult,
  updateErrorCode,
} from '../../src/runner-protocol/update.ts';
import { BUILD, RUNNER_EXAMPLES, SERVER_EXAMPLES } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

describe('runner.hello build and caps.selfUpdate', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];

  it('reads an old runner without them: no build said, and no self-update', () => {
    const old = { ...without(hello, 'build'), caps: without(hello.caps, 'selfUpdate') };
    const parsed = RunnerHello.parse(old);
    expect(parsed.build).toBeUndefined();
    expect(parsed.caps.selfUpdate).toBe(false);
  });

  it('takes a build, null from the sources, and a self-update flag', () => {
    expect(RunnerHello.parse(hello)).toMatchObject({ build: BUILD, caps: { selfUpdate: true } });
    expect(RunnerHello.parse({ ...hello, build: null }).build).toBeNull();
  });

  it('refuses a build that is not a lower-case SHA-256, and a flag that is not a boolean', () => {
    expect(issuesOf(RunnerHello, { ...hello, build: 'AB'.repeat(32) })).toEqual(['build']);
    expect(issuesOf(RunnerHello, { ...hello, build: 'ab'.repeat(31) })).toEqual(['build']);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...hello.caps, selfUpdate: 'yes' } })).toEqual([
      'caps.selfUpdate',
    ]);
    expect(issuesOf(RunnerBuild, BUILD)).toEqual([]);
  });
});

describe('runner.hello builtAt', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];

  it('reads a runner older than versioned runners, which leaves it out, as null', () => {
    expect(RunnerHello.parse(without(hello, 'builtAt')).builtAt).toBeNull();
  });

  it('takes the build time stamped into the bundle, or null from the sources', () => {
    expect(RunnerHello.parse({ ...hello, builtAt: '2026-11-09T16:40:00.000Z' }).builtAt).toBe(
      '2026-11-09T16:40:00.000Z',
    );
    expect(RunnerHello.parse({ ...hello, builtAt: null }).builtAt).toBeNull();
  });

  it('refuses a time that is not an ISO 8601 UTC time', () => {
    expect(issuesOf(RunnerHello, { ...hello, builtAt: '9 Nov 16:40' })).toEqual(['builtAt']);
  });
});

describe('runner.update and runner.update.result', () => {
  it('needs a command id', () => {
    expect(issuesOf(RunnerUpdate, SERVER_EXAMPLES['runner.update'])).toEqual([]);
    expect(issuesOf(RunnerUpdate, { type: 'runner.update', cmdId: 'x' })).toEqual(['cmdId']);
  });

  it('answers ok with the new build, or not ok with why', () => {
    const result = RUNNER_EXAMPLES['runner.update.result'];
    expect(issuesOf(RunnerUpdateResult, result)).toEqual([]);
    expect(issuesOf(RunnerUpdateResult, without(result, 'build'))).toEqual([]);
    const refused = { ...without(result, 'build'), ok: false, error: 'busy: 1 live run' };
    expect(issuesOf(RunnerUpdateResult, refused)).toEqual([]);
    expect(issuesOf(RunnerUpdateResult, { ...result, build: 'nope' })).toEqual(['build']);
    expect(issuesOf(RunnerUpdateResult, { ...refused, error: '' })).toEqual(['error']);
  });

  it('reads the code of an error', () => {
    for (const code of RUNNER_UPDATE_ERRORS) expect(updateErrorCode(`${code}: words`)).toBe(code);
    expect(updateErrorCode('unsupported')).toBe('unsupported');
    expect(updateErrorCode('unknown command runner.update')).toBeUndefined();
    expect(updateErrorCode(undefined)).toBeUndefined();
  });
});

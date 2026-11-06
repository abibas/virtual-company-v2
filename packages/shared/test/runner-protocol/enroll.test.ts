import { describe, expect, it } from 'vitest';
import {
  ENROLLMENT_TOKEN_PATTERN,
  ENROLLMENT_TOKEN_TTL_MS,
  EnrollmentToken,
  RUNNER_ENROLL_PATH,
  RunnerEnrollRequest,
  RunnerEnrollResponse,
} from '../../src/runner-protocol.ts';
import { IDS } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

const TOKEN = `mwc_et_${'A1b2C3d4'.repeat(4)}`;
const REQUEST = {
  token: TOKEN,
  name: 'Airia devbox',
  kind: 'vm',
  os: 'linux',
  arch: 'x64',
  hostname: 'dev-ihorherasko',
  unixUser: 'ihor',
  runnerVersion: '0.5.0',
  claudeVersion: '2.1.3 (Claude Code)',
  provider: 'airia_devbox',
  providerRef: { instance: 'dev-ihorherasko', zone: 'europe-west1-b', size: 'm' },
} as const;
const LAPTOP = {
  ...REQUEST,
  kind: 'laptop',
  provider: 'none',
  providerRef: null,
  claudeVersion: null,
} as const;

describe('the enrollment token', () => {
  it('is mwc_et_ and 32 base62 characters, good for an hour, traded at /api/runner/enroll', () => {
    expect(ENROLLMENT_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(EnrollmentToken.safeParse(TOKEN).success).toBe(true);
    for (const bad of [
      TOKEN.slice(0, -1),
      `${TOKEN}x`,
      TOKEN.replace('mwc_et_', 'mwc_rk_'),
      `${TOKEN.slice(0, -1)}-`,
    ]) {
      expect(EnrollmentToken.safeParse(bad).success).toBe(false);
    }
    expect(ENROLLMENT_TOKEN_TTL_MS).toBe(3_600_000);
    expect(RUNNER_ENROLL_PATH).toBe('/api/runner/enroll');
  });
});

describe('RunnerEnrollRequest', () => {
  it('takes a devbox with its reference and a laptop with none, and trims the name', () => {
    expect(issuesOf(RunnerEnrollRequest, REQUEST)).toEqual([]);
    expect(issuesOf(RunnerEnrollRequest, LAPTOP)).toEqual([]);
    expect(RunnerEnrollRequest.parse({ ...LAPTOP, name: '  This Mac  ' }).name).toBe('This Mac');
  });

  it('refuses a bad token, name, kind, version or text', () => {
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, token: 'mwc_et_short' })).toEqual(['token']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, name: '   ' })).toEqual(['name']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, name: 'x'.repeat(81) })).toEqual(['name']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, kind: 'phone' })).toEqual(['kind']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, runnerVersion: 'v1' })).toEqual(['runnerVersion']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, claudeVersion: '' })).toEqual(['claudeVersion']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, os: '' })).toEqual(['os']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, hostname: 'h'.repeat(256) })).toEqual(['hostname']);
    expect(issuesOf(RunnerEnrollRequest, without(REQUEST, 'unixUser'))).toEqual(['unixUser']);
  });

  it('holds the provider and its reference together', () => {
    expect(issuesOf(RunnerEnrollRequest, { ...LAPTOP, providerRef: { instance: 'x' } })).toEqual([
      'providerRef',
    ]);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, providerRef: null })).toEqual(['providerRef']);
    expect(
      issuesOf(RunnerEnrollRequest, {
        ...REQUEST,
        providerRef: { instance: 'Dev_Box', zone: 'europe-west1-b' },
      }),
    ).toEqual(['providerRef.instance']);
    expect(issuesOf(RunnerEnrollRequest, { ...REQUEST, provider: 'gcp' })).toEqual(['provider']);
  });
});

describe('RunnerEnrollResponse', () => {
  it("carries the machine's id, its company and a runner key", () => {
    const response = {
      machineId: IDS.machine,
      companyId: IDS.company,
      runnerKey: `mwc_rk_${'Z9'.repeat(16)}`,
    };
    expect(issuesOf(RunnerEnrollResponse, response)).toEqual([]);
    expect(issuesOf(RunnerEnrollResponse, { ...response, runnerKey: `mwc_pk_${'Z9'.repeat(16)}` })).toEqual([
      'runnerKey',
    ]);
    expect(issuesOf(RunnerEnrollResponse, { ...response, machineId: 'm-1' })).toEqual(['machineId']);
  });
});

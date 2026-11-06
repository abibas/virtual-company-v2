import { MACHINE_POWER_ERROR_MESSAGES } from '@mwc/machines-core';
import { describe, expect, it } from 'vitest';
import { codeOf, DETAIL_MAX, detailOf, errorOf, spawnErrorOf } from '../src/errors.ts';
import { fail, NOT_FOUND_STDERR, REAUTH_STDERR, timedOut } from './fixtures/gce.ts';

describe('codeOf', () => {
  it('recognizes gcloud’s and the airia CLI’s words', () => {
    expect(codeOf(NOT_FOUND_STDERR)).toBe('not_found');
    expect(codeOf('error: no devbox named dev-x in airia-devbox.')).toBe('not_found');
    expect(codeOf(REAUTH_STDERR)).toBe('needs_gcloud_login');
    expect(codeOf('error: your gcloud credentials have expired or are missing.')).toBe('needs_gcloud_login');
    expect(codeOf('error: no active gcloud account. Run: gcloud auth login')).toBe('needs_gcloud_login');
    expect(codeOf("error: can't start dev-x: the us-central1 region's vCPU quota is full")).toBe(
      'stockout_or_quota',
    );
    expect(codeOf("error: can't start dev-x: GCP has no capacity for it in us-central1-a right now")).toBe(
      'stockout_or_quota',
    );
    expect(codeOf('ERROR: ZONE_RESOURCE_POOL_EXHAUSTED: the zone does not have enough resources')).toBe(
      'stockout_or_quota',
    );
    expect(codeOf("ERROR: Quota 'CPUS' exceeded. Limit: 200.0 in region us-central1.")).toBe(
      'stockout_or_quota',
    );
    expect(codeOf('env: airia: No such file or directory')).toBe('cli_missing');
    expect(codeOf('bash: gcloud: command not found')).toBe('cli_missing');
    expect(codeOf('ERROR: something else')).toBe('failed');
  });
});

describe('detailOf', () => {
  it('keeps the last line that says something, without colours or tokens, and short', () => {
    expect(detailOf('first\n\u001b[1;31merror:\u001b[0m the box is busy\n\n')).toBe('error: the box is busy');
    expect(detailOf(REAUTH_STDERR)).toBe('to obtain new credentials. [redacted]');
    expect(detailOf(`refresh 1//0gAbc-def_123 and ${'x'.repeat(45)}`)).toBe(
      'refresh [redacted] and [redacted]',
    );
    const long = detailOf('word '.repeat(100)) ?? '';
    expect(long).toHaveLength(DETAIL_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(detailOf(' \n ')).toBeUndefined();
  });
});

describe('errorOf', () => {
  it('maps a timeout, exit 127 and the words, with a token-free detail', () => {
    expect(errorOf(timedOut(), 'Starting the box')).toMatchObject({ code: 'timeout', detail: undefined });
    expect(errorOf(fail('', 127), 'airia')).toMatchObject({ code: 'cli_missing' });
    const login = errorOf(fail(REAUTH_STDERR), 'Reading the box');
    expect(login).toMatchObject({
      code: 'needs_gcloud_login',
      message: MACHINE_POWER_ERROR_MESSAGES.needs_gcloud_login,
    });
    expect(login.detail).not.toContain('ya29');
    expect(errorOf(fail('', 1, 'ERROR: odd'), 'Stopping the box')).toMatchObject({
      code: 'failed',
      message: 'Stopping the box failed.',
      detail: 'ERROR: odd',
    });
  });
});

describe('spawnErrorOf', () => {
  it('reads ENOENT as a missing tool and anything else as a failure', () => {
    const missing = Object.assign(new Error('spawn airia ENOENT'), { code: 'ENOENT' });
    expect(spawnErrorOf(missing, 'airia')).toMatchObject({ code: 'cli_missing', cause: missing });
    expect(spawnErrorOf(new Error('EACCES'), 'gcloud')).toMatchObject({
      code: 'failed',
      message: 'gcloud could not be started.',
    });
    expect(spawnErrorOf(null, 'gcloud').code).toBe('failed');
  });
});

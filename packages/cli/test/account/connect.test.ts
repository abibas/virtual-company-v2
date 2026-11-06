import { describe, expect, it } from 'vitest';
import { connect, fail, usageError } from '../../src/account/connect.ts';
import { parseArgs } from '../../src/args.ts';
import { fakeApi, KEY, meBody, SERVER, tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';

describe('what the company commands share', () => {
  it('says the failure on stderr and returns its code', () => {
    const c = capture();
    expect(fail(c.io, 'mwc x', 'no')).toBe(1);
    expect(fail(c.io, 'mwc x', 'usage', 2)).toBe(2);
    expect(c.err()).toBe('mwc x: no\nmwc x: usage\n');
  });

  it('wants the one subcommand and a value for each option', () => {
    expect(usageError(parseArgs(['machine', 'enroll-token']), 'enroll-token', ['company'])).toBeUndefined();
    expect(usageError(parseArgs(['machine']), 'enroll-token', [])).toBe('expected "enroll-token"');
    expect(usageError(parseArgs(['machine', 'a', 'b']), 'enroll-token', [])).toBe(
      'expected "enroll-token", got "a b"',
    );
    expect(usageError(parseArgs(['machine', 'enroll-token', '--company']), 'enroll-token', ['company'])).toBe(
      '--company needs a value',
    );
  });

  it('connects with MWC_SERVER and MWC_API_KEY to the only company, or says why not', async () => {
    const env = { ...tempConfig().env, MWC_SERVER: SERVER, MWC_API_KEY: KEY };
    const ok = capture({ env });
    const session = await connect('mwc x', parseArgs(['x']), ok.io, { fetch: fakeApi().fetch });
    expect(session).toMatchObject({ server: SERVER, key: KEY, company: meBody().memberships[0] });
    const out = capture({ env: tempConfig().env });
    expect(await connect('mwc x', parseArgs(['x']), out.io, { fetch: fakeApi().fetch })).toBe(1);
    expect(out.err()).toMatch(/^mwc x: not logged in/);
  });
});

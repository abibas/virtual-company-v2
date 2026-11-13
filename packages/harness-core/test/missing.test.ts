import { describe, expect, it } from 'vitest';
import { FAKE_SESSION_MISSING, FakeHarnessDriver } from '../src/fake.ts';
import { lineMatching, SESSION_MISSING_LINE_MAX } from '../src/missing.ts';

describe('lineMatching', () => {
  it('gives the first matching line, on one line, cut to its limit; nothing without one', () => {
    const output = 'starting\n  No conversation   found here\r\nlater: No conversation found again\n';
    expect(lineMatching(output, /No conversation/)).toBe('No conversation found here');
    expect(lineMatching(output, /rollout/)).toBeUndefined();
    expect(lineMatching('', /x/)).toBeUndefined();
    const long = lineMatching(`missing ${'x'.repeat(1000)}`, /missing/) as string;
    expect(long).toHaveLength(SESSION_MISSING_LINE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it("is the fake driver's word for a lost conversation", () => {
    const driver = new FakeHarnessDriver();
    expect(driver.sessionMissing(`boot\n${FAKE_SESSION_MISSING}: s-1\n`)).toBe(
      `${FAKE_SESSION_MISSING}: s-1`,
    );
    expect(driver.sessionMissing('exited with code 1')).toBeUndefined();
  });
});

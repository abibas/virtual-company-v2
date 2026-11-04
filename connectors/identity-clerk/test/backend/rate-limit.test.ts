import { describe, expect, it } from 'vitest';
import { INVITATION_LIMIT, RateGate } from '../../src/backend/rate-limit.ts';

function gate(limit: { count: number; windowMs: number } = INVITATION_LIMIT) {
  let now = 1_000;
  const g = new RateGate(() => now, limit);
  return { g, tick: (ms: number) => (now += ms) };
}

function refusal(run: () => void) {
  try {
    run();
  } catch (error) {
    return error as { code: string; retryAfterMs: number };
  }
  throw new Error('expected a refusal');
}

describe('RateGate', () => {
  it('lets calls through until a 429 closes the bucket for its Retry-After', () => {
    const { g, tick } = gate();
    g.check('invitations');
    g.block('invitations', 5_000);
    expect(refusal(() => g.check('invitations'))).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 5_000,
    });
    g.check('api');
    tick(4_000);
    expect(refusal(() => g.check('invitations')).retryAfterMs).toBe(1_000);
    tick(1_000);
    g.check('invitations');
  });

  it('closes every bucket after a 429 on the whole API, and keeps the later of two blocks', () => {
    const { g, tick } = gate();
    g.block('api', 2_000);
    g.block('api', 1_000);
    expect(refusal(() => g.check('invitations')).retryAfterMs).toBe(2_000);
    tick(2_000);
    g.check('invitations');
  });

  it('keeps Clerk’s 250 invitations an hour, freeing slots as they age out of the window', () => {
    expect(INVITATION_LIMIT).toEqual({ count: 250, windowMs: 3_600_000 });
    const { g, tick } = gate({ count: 3, windowMs: 1_000 });
    g.takeInvitation();
    tick(100);
    g.takeInvitation();
    g.takeInvitation();
    expect(refusal(() => g.takeInvitation())).toMatchObject({ code: 'rate_limited', retryAfterMs: 900 });
    tick(900);
    g.takeInvitation();
    expect(refusal(() => g.takeInvitation()).retryAfterMs).toBe(100);
  });
});

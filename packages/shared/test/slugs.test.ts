import { describe, expect, it } from 'vitest';
import { isReservedSlug, RESERVED_SLUGS, SLUG_MAX, SLUG_PATTERN, slugify, withSuffix } from '../src/slugs.ts';

describe('the slug rule', () => {
  it('derives lower-case kebab from a name, accents dropped', () => {
    expect(slugify('SLOP BOX', 'agent')).toBe('slop-box');
    expect(slugify('  Café — Über & Co!  ', 'agent')).toBe('cafe-uber-co');
    expect(slugify('Code_Reviewer 2', 'agent')).toBe('code-reviewer-2');
  });

  it('falls back to the caller’s word when nothing is left', () => {
    expect(slugify('!!!', 'agent')).toBe('agent');
    expect(slugify('日本語', 'company')).toBe('company');
  });

  it('stays within 63 characters, with a suffix too', () => {
    expect(slugify('a'.repeat(80), 'agent')).toHaveLength(SLUG_MAX);
    expect(withSuffix('b'.repeat(63), '2')).toBe(`${'b'.repeat(61)}-2`);
    expect(withSuffix(`${'z'.repeat(60)}-yy`, '10')).toBe(`${'z'.repeat(60)}-10`);
    for (const slug of [slugify('x'.repeat(70), 'agent'), withSuffix('y'.repeat(63), '12')]) {
      expect(slug).toMatch(SLUG_PATTERN);
    }
  });
});

describe('the reserved slugs', () => {
  it('keeps the app’s and the server’s first path segments, the old company prefix among them', () => {
    const kept = ['c', 'api', 'assets', 'design', 'sign-in', 'sign-up', 'sign-out', 'companies'];
    kept.push('accept-invitation', 'onboarding', 'profile', 'account', 'settings', 'me', 'new', 'admin');
    kept.push('docs', 'healthz', 'readyz', 'static', 'favicon.ico', 'robots.txt');
    for (const slug of kept) expect(isReservedSlug(slug), slug).toBe(true);
  });

  it('leaves ordinary company names free, and lists only lower-case segments without slashes', () => {
    for (const slug of ['most-wanted', 'acme', 'c-2', 'settings-2', 'apis', 'company']) {
      expect(isReservedSlug(slug), slug).toBe(false);
    }
    for (const slug of RESERVED_SLUGS) expect(slug).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
  });
});

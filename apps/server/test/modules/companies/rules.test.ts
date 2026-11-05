import { describe, expect, it } from 'vitest';
import {
  audited,
  changedFields,
  creationRefusal,
  detectLogoType,
  FALLBACK_SLUG,
  nameConfirmed,
  SLUG_MAX,
  SLUG_PATTERN,
  slugCandidates,
  slugify,
  withSuffix,
} from '../../../src/modules/companies/rules.ts';

describe('slugify', () => {
  it('makes lower-case kebab from a name, without accents or dashes at either end', () => {
    expect(slugify('Acme Robotics')).toBe('acme-robotics');
    expect(slugify('  Café — Über & Co!  ')).toBe('cafe-uber-co');
    expect(slugify('--Most__Wanted--Corp--')).toBe('most-wanted-corp');
    expect(slugify('ÅNGSTRÖM 2026')).toBe('angstrom-2026');
  });

  it('falls back to "company" for a name with no letter or digit, and cuts long names at 63 characters', () => {
    expect(slugify('!!!')).toBe(FALLBACK_SLUG);
    expect(slugify('日本語')).toBe(FALLBACK_SLUG);
    expect(slugify('a'.repeat(80))).toHaveLength(SLUG_MAX);
    expect(slugify(`${'a'.repeat(62)} b`)).toBe('a'.repeat(62));
    for (const name of ['x', 'Acme Robotics', `${'ab-'.repeat(30)}`, '!!!'])
      expect(slugify(name)).toMatch(SLUG_PATTERN);
  });
});

describe('slugCandidates', () => {
  it('is only the chosen slug when there is one', () => {
    expect(slugCandidates('Acme', 'my-acme', () => 'zzz')).toEqual(['my-acme']);
  });

  it('numbers a derived slug from 2 to 10, then adds random suffixes, all within 63 characters', () => {
    let n = 0;
    const candidates = slugCandidates('Acme', undefined, () => `r${++n}`);
    expect(candidates).toEqual([
      'acme',
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `acme-${i}`),
      'acme-r1',
      'acme-r2',
      'acme-r3',
    ]);
    const long = slugCandidates('y'.repeat(70), undefined, () => 'abcdef');
    expect(long.every((slug) => slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug))).toBe(true);
    expect(long.at(1)).toBe(`${'y'.repeat(61)}-2`);
    expect(withSuffix(`${'z'.repeat(55)}-${'w'.repeat(10)}`, 'abcdef')).toBe(`${'z'.repeat(55)}-abcdef`);
  });
});

describe('creationRefusal', () => {
  const creators = ['ihor@example.com'];
  it('lets everyone create under any, nobody under none, and only the listed emails under allowlist', () => {
    expect(creationRefusal('any', [], undefined)).toBeUndefined();
    expect(creationRefusal('none', creators, 'ihor@example.com')).toBe('company_creation_disabled');
    expect(creationRefusal('allowlist', creators, 'Ihor@Example.com')).toBeUndefined();
    expect(creationRefusal('allowlist', creators, 'someone@example.com')).toBe(
      'company_creation_not_allowed',
    );
    expect(creationRefusal('allowlist', creators, undefined)).toBe('company_creation_not_allowed');
    expect(creationRefusal('allowlist', [], 'ihor@example.com')).toBe('company_creation_not_allowed');
  });
});

describe('nameConfirmed, changedFields and audited', () => {
  it('confirms a deletion only with the exact name, around which spaces do not count', () => {
    expect(nameConfirmed('Acme', 'Acme')).toBe(true);
    expect(nameConfirmed('  Acme ', 'Acme')).toBe(true);
    expect(nameConfirmed('acme', 'Acme')).toBe(false);
    expect(nameConfirmed('', 'Acme')).toBe(false);
  });

  it('keeps only the fields of a patch that change something', () => {
    const company = { name: 'Acme', slug: 'acme' };
    expect(changedFields(company, { name: 'Acme', slug: 'acme' })).toEqual({});
    expect(changedFields(company, { name: 'Acme Corp' })).toEqual({ name: 'Acme Corp' });
    expect(changedFields(company, { slug: 'acme-corp', name: 'Acme' })).toEqual({ slug: 'acme-corp' });
    expect(changedFields(company, {})).toEqual({});
  });

  it('picks the audited fields of a company row', () => {
    const row = {
      id: 'c1',
      name: 'A',
      slug: 'a',
      status: 'active',
      identityOrgId: null,
      deletedAt: null,
      settings: {},
    };
    expect(audited(row)).toEqual({
      name: 'A',
      slug: 'a',
      status: 'active',
      identityOrgId: null,
      deletedAt: null,
    });
  });
});

describe('detectLogoType', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const RIFF = [0x52, 0x49, 0x46, 0x46];
  const WEBP = [0x57, 0x45, 0x42, 0x50];

  it('tells a PNG, a JPEG and a WebP from their first bytes, whatever follows', () => {
    expect(detectLogoType(bytes(...PNG, 0, 0, 0, 13))).toBe('image/png');
    expect(detectLogoType(bytes(...PNG))).toBe('image/png');
    expect(detectLogoType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectLogoType(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(detectLogoType(bytes(...RIFF, 0x1a, 0, 0, 0, ...WEBP, 0x56))).toBe('image/webp');
    expect(detectLogoType(bytes(...RIFF, 0xff, 0xff, 0xff, 0xff, ...WEBP))).toBe('image/webp');
  });

  it('knows nothing else: GIF, SVG, other RIFF files, signatures cut short or bent, nothing at all', () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(detectLogoType(text('GIF89a'))).toBeUndefined();
    expect(detectLogoType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(detectLogoType(bytes(...RIFF, 0x1a, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeUndefined();
    expect(detectLogoType(bytes(...RIFF, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42))).toBeUndefined();
    expect(detectLogoType(bytes(...PNG.slice(0, 7)))).toBeUndefined();
    expect(detectLogoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00))).toBeUndefined();
    expect(detectLogoType(bytes(0xff, 0xd8))).toBeUndefined();
    expect(detectLogoType(bytes(0xff, 0xd8, 0x00))).toBeUndefined();
    expect(detectLogoType(bytes())).toBeUndefined();
  });
});

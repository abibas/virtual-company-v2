import { describe, expect, it } from 'vitest';
import { accountFrom, boxNameOf, ownerSlug } from '../src/account.ts';

describe('ownerSlug', () => {
  it('folds an account to the airia CLI’s slug and box name', () => {
    expect(ownerSlug('jjmanton@airia.com')).toBe('jjmanton');
    expect(ownerSlug(' Ihor.Herasko@airia.com\n')).toBe('ihor-herasko');
    expect(ownerSlug('_odd+name_@x.io')).toBe('odd-name');
    expect(ownerSlug(`${'a'.repeat(60)}@x.io`)).toHaveLength(50);
    expect(ownerSlug('')).toBe('');
    expect(boxNameOf('Ihor.Herasko@airia.com')).toBe('dev-ihor-herasko');
  });
});

describe('accountFrom', () => {
  it('reads the account, or null when none is set', () => {
    expect(accountFrom('ihor@airia.com\n')).toBe('ihor@airia.com');
    expect(accountFrom('(unset)\n')).toBeNull();
    expect(accountFrom('  ')).toBeNull();
  });
});

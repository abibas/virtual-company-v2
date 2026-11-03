import { describe, expect, it } from 'vitest';
import { ActorKind, CompanyStatus, UserStatus } from './enums.ts';

describe('enums', () => {
  it('lists the values the database CHECK constraints allow', () => {
    expect(CompanyStatus.options).toEqual(['provisioning', 'active', 'suspended', 'deleted']);
    expect(UserStatus.options).toEqual(['active', 'deactivated']);
    expect(ActorKind.options).toEqual(['user', 'agent', 'system', 'identity']);
  });

  it('accepts known values and rejects others', () => {
    expect(CompanyStatus.parse('active')).toBe('active');
    expect(UserStatus.safeParse('banned').success).toBe(false);
    expect(ActorKind.safeParse('User').success).toBe(false);
  });
});

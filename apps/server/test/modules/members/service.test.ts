import type { Membership } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import { memberView } from '../../../src/modules/members/service.ts';

describe('memberView', () => {
  const row = {
    id: '019a4f0c-0000-7000-8000-000000000001',
    userId: '019a4f0c-0000-7000-8000-000000000002',
    principalId: '019a4f0c-0000-7000-8000-000000000003',
    role: 'member',
    status: 'active',
    createdAt: new Date('2026-11-04T10:00:00.000Z'),
  } as Membership;

  it('shows the person from their profile', () => {
    const profile = {
      displayName: 'Ada',
      primaryEmail: 'ada@example.test',
      imageUrl: 'https://img.test/ada.png',
    };
    expect(memberView(row, profile)).toEqual({
      id: row.id,
      userId: row.userId,
      principalId: row.principalId,
      displayName: 'Ada',
      email: 'ada@example.test',
      imageUrl: 'https://img.test/ada.png',
      role: 'member',
      status: 'active',
      joinedAt: '2026-11-04T10:00:00.000Z',
    });
  });

  it('shows no name, an empty email and no photo when the profile is missing', () => {
    expect(memberView(row, undefined)).toMatchObject({ displayName: null, email: '', imageUrl: null });
  });
});

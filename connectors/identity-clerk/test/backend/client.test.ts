import { verifyToken } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { describe, expect, it } from 'vitest';
import { clerkBackend } from '../../src/backend/client.ts';
import { SECRET_KEY } from '../fixtures/backend.ts';

describe('clerkBackend', () => {
  it("is the real SDK: a Backend API client and Clerk's own verifiers, without a network call", () => {
    const backend = clerkBackend(SECRET_KEY);
    expect(backend.verifyToken).toBe(verifyToken);
    expect(backend.verifyWebhook).toBe(verifyWebhook);
    expect(typeof backend.api.users.getUser).toBe('function');
    expect(typeof backend.api.organizations.createOrganizationInvitation).toBe('function');
  });
});

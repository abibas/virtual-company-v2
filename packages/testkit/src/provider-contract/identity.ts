import { expect } from 'vitest';
import { type ContractCase, need, providerError } from './state.ts';

export const describesItself: ContractCase = {
  name: 'describes itself: kind, an https issuer, capabilities, an admin-like role for owners and admins',
  async run({ provider }) {
    expect(provider.kind).toMatch(/^[a-z]+$/);
    expect(provider.issuer).toMatch(/^https:\/\/\S+$/);
    expect(provider.capabilities).toEqual({
      organizations: true,
      invitations: true,
      webhooks: true,
      scim: false,
    });
    const adminLike = (['owner', 'admin', 'member', 'viewer'] as const).map((role) =>
      provider.roles.isAdmin(provider.roles.toProvider(role)),
    );
    expect(adminLike).toEqual([true, true, false, false]);
  },
};

export const getsUsers: ContractCase = {
  name: 'getUser returns a person who signed up, and null for nobody',
  async run(state) {
    const { target, provider } = state;
    state.owner = await target.createUser('owner', 'Contract Owner');
    const found = await provider.getUser(state.owner.subject);
    expect(found).toMatchObject({
      subject: state.owner.subject,
      primaryEmail: target.email('owner').toLowerCase(),
      displayName: 'Contract Owner',
    });
    expect(found?.updatedAt).toBeGreaterThan(0);
    expect(await provider.getUser(target.missing.subject)).toBeNull();
  },
};

export const verifiesTokens: ContractCase = {
  name: 'verifyAccessToken accepts a session token and refuses garbage or a tampered token as unauthorized',
  async run({ target, provider, owner }) {
    const subject = need(owner, 'owner').subject;
    const { token, authorizedParties } = await target.mintToken(subject);
    const identity = await provider.verifyAccessToken(token, { authorizedParties });
    expect(identity).toMatchObject({ issuer: provider.issuer, subject, pending: false });
    expect(identity.sessionId).toEqual(expect.any(String));
    for (const bad of ['not-a-token', `${token}x`]) {
      expect((await providerError(() => provider.verifyAccessToken(bad, { authorizedParties }))).code).toBe(
        'unauthorized',
      );
    }
  },
};

export const parsesWebhooks: ContractCase = {
  name: 'parseWebhook normalizes a signed delivery and refuses an unsigned or tampered one as unauthorized',
  async run({ target, provider, owner }) {
    const subject = need(owner, 'owner').subject;
    const delivery = target.signedUserDeleted(subject);
    const event = await provider.parseWebhook(delivery);
    expect(event).toMatchObject({ provider: provider.kind, type: 'user.deleted', data: { subject } });
    expect(event?.externalEventId).toEqual(expect.any(String));
    const unsigned = { headers: { 'content-type': 'application/json' }, rawBody: delivery.rawBody };
    const tampered = { headers: delivery.headers, rawBody: delivery.rawBody.replace(subject, `${subject}x`) };
    for (const request of [unsigned, tampered]) {
      expect((await providerError(() => provider.parseWebhook(request))).code).toBe('unauthorized');
    }
  },
};

/**
 * The auth tests' world: a test app with the fake identity provider on a fixed clock, probe routes that put
 * `requireMembership(role)` behind `authn()` (test-only: production has no company routes until S1.5), and
 * helpers that seed people and API keys straight into the tables.
 */
import { randomBytes } from 'node:crypto';
import { apiKeys, type DbHandle, memberships, principals, tenant, userIdentities, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { ApiKeyKind, MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import {
  type App,
  createTestApp,
  FAKE_ISSUER,
  FakeIdentityProvider,
  fixedClock,
  type TestApp,
  type TestClock,
  testConfig,
} from '@mwc/testkit';
import type { Hono } from 'hono';
import { hashApiKey } from '../../src/platform/auth/api-keys.ts';
import { type AuthDeps, authn } from '../../src/platform/auth/authn.ts';
import { requireMembership } from '../../src/platform/auth/membership.ts';
import type { AppEnv } from '../../src/platform/env.ts';

/** The origin the test configuration accepts tokens from (MWC_WEB_ORIGIN's default). */
export const WEB_ORIGIN = testConfig.MWC_WEB_ORIGIN;

export interface AuthWorld {
  readonly t: TestApp;
  readonly fake: FakeIdentityProvider;
  readonly clock: TestClock;
  readonly deps: AuthDeps;
}

/** `GET /api/companies/:companyId/probe/<role>` for every role: authn(), then requireMembership(role). */
export function mountProbe(app: App | Hono<AppEnv>, deps: AuthDeps): void {
  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    app.get(`/api/companies/:companyId/probe/${role}`, authn(deps), requireMembership(deps, role), (c) =>
      c.json({ companyId: c.var.tenant.companyId, membership: c.var.membership, actor: c.var.actor }),
    );
  }
}

/** A test app with the fake provider and the probe routes, both on one fixed clock. */
export async function authWorld(): Promise<AuthWorld> {
  const clock = fixedClock();
  const fake = new FakeIdentityProvider({ clock });
  const t = await createTestApp({ clock, identity: fake });
  const deps: AuthDeps = { db: t.db, config: testConfig, logger: t.logger, identity: fake };
  mountProbe(t.app, deps);
  return { t, fake, clock, deps };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A subject nobody has used yet. */
export const newSubject = (label = 'user') => `${label}_${randomBytes(4).toString('hex')}`;

export interface PersonOptions {
  readonly role?: MembershipRole;
  readonly status?: MembershipStatus;
  readonly subject?: string;
  readonly deactivated?: boolean;
}

export interface Person {
  readonly subject: string;
  readonly userId: string;
  readonly principalId: string;
  readonly membershipId: string;
}

/** A person the fake knows, linked here (user and identity), with a membership in the company. */
export async function addPerson(
  db: DbHandle,
  fake: FakeIdentityProvider,
  companyId: string,
  options: PersonOptions = {},
): Promise<Person> {
  const subject = options.subject ?? newSubject();
  const email = `${subject}@people.test`;
  fake.createUser({ subject, email });
  const raw = rawDb(db);
  const [user] = await raw
    .insert(users)
    .values({
      primaryEmail: email,
      displayName: subject,
      status: options.deactivated ? 'deactivated' : 'active',
    })
    .returning();
  const userId = (user as { id: string }).id;
  await raw.insert(userIdentities).values({ userId, provider: 'fake', issuer: FAKE_ISSUER, subject });
  const scoped = await tenant(db, companyId);
  const [principal] = await scoped.insert(principals, { kind: 'person' }).returning();
  const principalId = (principal as { id: string }).id;
  const role = options.role ?? 'member';
  const [membership] = await scoped
    .insert(memberships, { principalId, userId, role, grantedRole: role, status: options.status ?? 'active' })
    .returning();
  return { subject, userId, principalId, membershipId: (membership as { id: string }).id };
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A well-formed API key that is not stored anywhere: `mwc_<prefix>_` and 32 base62 characters. */
export function newApiKey(prefix = 'pk'): string {
  const bytes = randomBytes(32);
  return `mwc_${prefix}_${[...bytes].map((b) => BASE62[b % 62]).join('')}`;
}

export interface SeedKeyOptions {
  readonly companyId: string;
  readonly principalId: string;
  readonly kind?: ApiKeyKind;
  readonly key?: string;
  readonly expiresAt?: Date | null;
  readonly revokedAt?: Date | null;
  readonly lastUsedAt?: Date | null;
}

/** An API key row as S1.9 will make it (only the SHA-256 stored); returns the key and its row id. */
export async function seedApiKey(
  db: DbHandle,
  options: SeedKeyOptions,
): Promise<{ key: string; id: string }> {
  const kind = options.kind ?? 'personal';
  const key = options.key ?? newApiKey(kind === 'personal' ? 'pk' : kind === 'runner' ? 'rk' : 'sc');
  const scoped = await tenant(db, options.companyId);
  const [row] = await scoped
    .insert(apiKeys, {
      principalId: options.principalId,
      kind,
      name: 'test key',
      prefix: key.slice(0, 11),
      secretHash: hashApiKey(key),
      ...(kind === 'runner' ? { machineId: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' } : {}),
      expiresAt: options.expiresAt ?? null,
      revokedAt: options.revokedAt ?? null,
      lastUsedAt: options.lastUsedAt ?? null,
    })
    .returning();
  return { key, id: (row as { id: string }).id };
}

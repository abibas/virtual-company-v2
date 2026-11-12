/**
 * The org tests' helpers: people placed on a company's chart (the members helpers add them without a place), the
 * agents and org paths, an agent made through the API, raw reads of the positions and audit rows a change leaves, and
 * the org module's side of a membership's start and end for the services tested without the app (`testChart`). For
 * the lifecycle tests (S2.4): a company whose owner has an admin under them, a person invited by someone and accepted
 * at the fake provider, the server learning of a membership's start or end by each path (a webhook delivery, the
 * reconcile on sign-in, the self reconcile, Sync now, the periodic reconcile of the jobs loop), and the chart as the
 * API shows it. For access profiles (S3.4): subscriptions of every kind sealed as the store seals them, profiles made
 * straight through the personal layer and put on agents and defaults straight in the tables, and raw reads of both; for
 * tool profiles (S7.1b) GitHub and Atlassian sign-ins with a fake account's details, and GitHub and Atlassian profiles.
 */
import { randomBytes } from 'node:crypto';
import {
  type AccessProfile,
  accessProfiles,
  agents,
  auditLog,
  credentials,
  type DbHandle,
  memberships,
  orgPositions,
  owned,
  tenant,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { defaultRights } from '@mwc/shared/credentials';
import type {
  AiProvider,
  CredentialKind,
  MembershipRole,
  MembershipStatus,
  ToolProvider,
} from '@mwc/shared/enums';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { validateChart } from '@mwc/shared/org-chart';
import { captureLogger, getJson, seedAgent, testConfig } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { expect } from 'vitest';
import { moduleJobs } from '../../src/app.ts';
import { credentialSecrets, type StoreCredentialInput } from '../../src/modules/credentials/index.ts';
import type { SubscriptionView } from '../../src/modules/credentials/schemas.ts';
import { SELF_RECONCILE_INTERVAL_MS } from '../../src/modules/identity/service.ts';
import type { MemberView } from '../../src/modules/members/schemas.ts';
import type { AgentDetailView, OrgChartView } from '../../src/modules/org/schemas.ts';
import { memberChart } from '../../src/modules/org/service/lifecycle.ts';
import type { Keyring } from '../../src/platform/secrets/keyring.ts';
import { deliverEvents, redelivered } from './identity/webhooks.ts';
import { acceptAtProvider, invite, memberWithEmail, runOutbox, signUp } from './members/invitations.ts';
import { as, type MembersCompany, membersCompany } from './members/members.ts';
import { type AuthWorld, addPerson, bearer, newSubject, type Person } from './platform/auth.ts';

export type { AgentDetailView, OrgChartView };

export const agentsPath = (company: Pick<MembersCompany, 'companyId'>, agentId?: string, query = '') =>
  `/api/companies/${company.companyId}/agents${agentId === undefined ? '' : `/${agentId}`}${query}`;

export const positionPath = (company: Pick<MembersCompany, 'companyId'>, principalId: string) =>
  `/api/companies/${company.companyId}/org/positions/${principalId}`;

export const chartPath = (company: Pick<MembersCompany, 'companyId'>) =>
  `/api/companies/${company.companyId}/org/chart`;

/** The org chart a membership that starts or ends moves its person on, as `createApp` composes it. */
export const testChart = (logger: Logger = captureLogger().logger) => memberChart({ logger });

/** Puts a principal on the chart straight into the table (no rules checked). */
export async function place(
  db: DbHandle,
  companyId: string,
  principalId: string,
  reportsTo: string | null,
  title: string | null = null,
): Promise<void> {
  const t = await tenant(db, companyId);
  await t.insert(orgPositions, { principalId, reportsToPrincipalId: reportsTo, title });
}

/** Takes a principal off the chart straight in the table (a place lost before S2.4's lifecycle hooks). */
export async function unplace(db: DbHandle, companyId: string, principalId: string): Promise<void> {
  const t = await tenant(db, companyId);
  await t.delete(orgPositions, eq(orgPositions.principalId, principalId));
}

/** A person with a membership (`role`, active unless said) placed under `reportsTo` (the owner by default). */
export async function placedMember(
  w: AuthWorld,
  company: MembersCompany,
  role: MembershipRole,
  options: { reportsTo?: string | null; status?: MembershipStatus } = {},
): Promise<Person> {
  const person = await addPerson(w.t.db, w.fake, company.companyId, {
    role,
    status: options.status ?? 'active',
  });
  const reportsTo = options.reportsTo === undefined ? company.owner.principalId : options.reportsTo;
  await place(w.t.db, company.companyId, person.principalId, reportsTo);
  return person;
}

/** Creates an agent through the API as `person` (the test fails on anything but a 201). */
export async function makeAgent(
  w: AuthWorld,
  company: MembersCompany,
  person: Person,
  body: Record<string, unknown> = {},
): Promise<AgentDetailView> {
  const res = await as(w, person)('POST', agentsPath(company), {
    name: 'SLOP BOX',
    roleTitle: 'Coder',
    ...body,
  });
  if (res.status !== 201) throw new Error(`POST agents answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as AgentDetailView;
}

/** The stored place of a principal, as `[reportsTo, title]`, or undefined when it has none. */
export async function placeOf(db: DbHandle, companyId: string, principalId: string) {
  const [row] = await rawDb(db)
    .select()
    .from(orgPositions)
    .where(and(eq(orgPositions.companyId, companyId), eq(orgPositions.principalId, principalId)));
  return row && ([row.reportsToPrincipalId, row.title] as const);
}

/** The audit rows of one entity, oldest first, as `[action, field, old, new]`. */
export async function auditTrail(db: DbHandle, entityType: string, entityId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
  return rows.map((row) => [row.action, row.field, row.oldValue, row.newValue] as const);
}

/** The audit rows of one entity, oldest first, with who made them. */
export async function auditRows(db: DbHandle, entityType: string, entityId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
  return rows.map(({ id: _id, createdAt: _at, ...row }) => row);
}

/** The paths by which the server learns that a membership started or ended at the provider. */
export const LEARNING_PATHS = [
  'webhook',
  'first sign-in',
  'self reconcile',
  'sync now',
  'periodic reconcile',
] as const;
export type LearningPath = (typeof LEARNING_PATHS)[number];

/** A company linked to an organization at the fake, its owner at the top, and an admin under the owner. */
export async function orgCompany(w: AuthWorld): Promise<MembersCompany & { readonly admin: Person }> {
  const company = await membersCompany(w);
  return { ...company, admin: await placedMember(w, company, 'admin') };
}

/** Someone who signed up at the fake and accepted an invitation there, with the events the fake sent for it. */
export interface Joiner {
  readonly subject: string;
  readonly email: string;
  readonly invitationId: string;
  readonly events: NormalizedIdentityEvent[];
}

/**
 * `by` invites a new email as `role` (to report to `reportsTo`, when given) through the API and the outbox sends it;
 * then the invitee signs up and accepts at the fake, which sends the events of both.
 */
export async function acceptedFrom(
  w: AuthWorld,
  company: MembersCompany,
  by: Person,
  role: 'owner' | 'admin' | 'member' = 'member',
  reportsTo?: string,
): Promise<Joiner> {
  const email = `${newSubject('joiner')}@joiners.test`;
  const sent = await invite(w, company, email, role, by, { reportsToPrincipalId: reportsTo });
  await runOutbox(w, company.companyId);
  w.fake.drainEvents();
  const person = signUp(w, sent.email);
  await acceptAtProvider(w, sent.id, person.subject);
  return { ...person, invitationId: sent.id, events: w.fake.drainEvents() };
}

/**
 * Someone `by` invited as an admin, who joined through the provider (learned by webhook), with a member and an agent
 * under them on the chart, the agent with an agent of its own.
 */
export async function managerWithReports(w: AuthWorld, company: MembersCompany, by: Person) {
  const joiner = await acceptedFrom(w, company, by, 'admin');
  await deliverEvents(w, joiner.events);
  const member = (await memberWithEmail(w, company, joiner.email)) as MemberView;
  const report = await placedMember(w, company, 'member', { reportsTo: member.principalId });
  const agent = (await seedAgent(w.t.db, company.companyId, { reportsTo: member.principalId })).principal.id;
  const subAgent = (await seedAgent(w.t.db, company.companyId, { reportsTo: agent })).principal.id;
  return { joiner, member, report, agent, subAgent };
}

/** The deps the jobs loop runs with, on the test app's database, fake and clock. */
const jobsOf = (w: AuthWorld) =>
  moduleJobs({
    db: w.t.db,
    config: testConfig,
    logger: w.t.logger,
    version: 'test',
    clock: w.clock,
    identity: w.fake,
  });

/** Delivers the events (round 1) or copies of them under new delivery ids; returns the membership event's id. */
async function viaWebhook(w: AuthWorld, events: readonly NormalizedIdentityEvent[], round: number) {
  const deliveries = round === 1 ? events : events.map((event) => redelivered(event));
  expect(new Set(await deliverEvents(w, deliveries))).toEqual(new Set(['processed']));
  const changed = deliveries.find((event) => event.type.startsWith('membership.'));
  return changed?.externalEventId ?? null;
}

/**
 * The server learns what happened at the provider to `subject`'s membership by `path`, a `round` after the first being
 * the same path again (another delivery id, another session, the next self reconcile turn). `events` are what the fake
 * sent for it. Returns the request id the audit rows of what changed carry.
 */
export async function learnBy(
  w: AuthWorld,
  company: MembersCompany,
  path: LearningPath,
  change: {
    readonly subject: string;
    readonly events: readonly NormalizedIdentityEvent[];
    readonly label: string;
  },
  round = 1,
): Promise<string | null> {
  const label = `${change.label}-${round}`;
  const headers = { ...bearer(`fake:${change.subject};sid=sess_${label}`), 'x-request-id': label };
  if (path === 'webhook') return viaWebhook(w, change.events, round);
  if (path === 'first sign-in') expect((await getJson(w.t.app, '/api/me', headers)).status).toBe(200);
  if (path === 'self reconcile') {
    if (round > 1) w.clock.advance(SELF_RECONCILE_INTERVAL_MS);
    const res = await w.t.app.request('/api/me/reconcile', { method: 'POST', headers });
    expect(res.status).toBe(200);
  }
  if (path === 'sync now') {
    const synced = await as(w, company.owner, label)('POST', `/api/companies/${company.companyId}/sync`);
    expect(synced.status).toBe(200);
  }
  if (path === 'periodic reconcile') {
    await jobsOf(w).reconcileCompany(company.companyId);
    return null;
  }
  return label;
}

/** The chart as the owner reads it through the API; a chart that breaks an invariant fails the test. */
export async function chartOf(w: AuthWorld, company: MembersCompany): Promise<OrgChartView> {
  const res = await as(w, company.owner)('GET', chartPath(company));
  expect(res.status).toBe(200);
  const chart = res.body as OrgChartView;
  expect(validateChart(chart.nodes)).toEqual([]);
  return chart;
}

/** Whom each of `principalIds` reports to on the chart (undefined: not on it). */
export async function managersOf(w: AuthWorld, company: MembersCompany, principalIds: readonly string[]) {
  const nodes = new Map((await chartOf(w, company)).nodes.map((node) => [node.principalId, node.reportsTo]));
  return principalIds.map((id) => (nodes.has(id) ? nodes.get(id) : undefined));
}

/** The `org_position` audit rows of a principal, oldest first, as `[action, by, requestId, old, new]`. */
export async function positionAudit(w: AuthWorld, principalId: string) {
  return (await auditRows(w.t.db, 'org_position', principalId)).map(
    (row) =>
      [row.action, row.actorPrincipalId ?? row.actorKind, row.requestId, row.oldValue, row.newValue] as const,
  );
}

export const PROFILES = '/api/me/access-profiles';

export const defaultPath = (companyId: string) => `/api/companies/${companyId}/me/default-profile`;

/** A secret of each kind's shape: made up, never a real one. */
const SECRETS: Readonly<Record<CredentialKind, unknown>> = {
  claude_oauth: {
    credentials: { claudeAiOauth: { accessToken: 'sk-ant-oat01-LOGINaccessNEVERshown' } },
    account: { emailAddress: 'ihor@example.com' },
  },
  claude_setup_token: { token: 'sk-ant-oat01-SETUPtokenNEVERshownAGAIN_0123456789' },
  codex_oauth: { auth: { tokens: { access_token: 'codex-ACCESStokenNEVERshown' } } },
  anthropic_api_key: { apiKey: 'sk-ant-api03-ANTHROPICkeyNEVERshown_abcdef' },
  openai_api_key: { apiKey: 'sk-proj-OPENAIkeyNEVERshown_ghijkl' },
  gateway: { headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' } },
  github_oauth: { token: 'gho_GHLOGINtokenNEVERshown' },
  github_token: { token: 'ghp_GHPASTEDtokenNEVERshown' },
  atlassian_api_token: {
    site: 'airia.atlassian.net',
    email: 'ihor@example.com',
    token: 'ATATT3ATLASSIANtokenNEVERshown',
  },
};

/** Asserts a body (or rows) carry no secret of the subscriptions these helpers seal. */
export function noSecret(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of [
    'LOGINaccess',
    'SETUPtoken',
    'codex-ACCESS',
    'ANTHROPICkey',
    'OPENAIkey',
    'HEADERvalue',
    'GHLOGINtoken',
    'GHPASTEDtoken',
    'ATLASSIANtoken',
  ]) {
    expect(text).not.toContain(secret);
  }
}

/** Seals a subscription of `kind` for a person, as the store does (`storeCredential`). */
export function addSubscription(
  w: AuthWorld,
  keyring: Keyring,
  userId: string,
  kind: CredentialKind,
  label = `${kind} ${randomBytes(2).toString('hex')}`,
): Promise<SubscriptionView> {
  const input = { kind, secret: SECRETS[kind], label, ownerUserId: userId } as StoreCredentialInput;
  return credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).storeCredential(input);
}

/** The fake account each tool sign-in acts as: GitHub's login, Atlassian's name, email and site. */
export const TOOL_ACCOUNTS = {
  github_oauth: {
    accountEmail: null,
    accountMeta: { host: 'github.com', login: 'ihor-fake', name: 'Ihor Fake' },
  },
  github_token: {
    accountEmail: null,
    accountMeta: { host: 'github.com', login: 'ihor-pat', tokenType: 'classic' },
  },
  atlassian_api_token: {
    accountEmail: 'ihor@example.test',
    accountMeta: {
      site: 'airia-fake.atlassian.net',
      jira: true,
      confluence: true,
      displayName: 'Ihor Herasko',
    },
  },
} as const;

/** Seals a GitHub or Atlassian sign-in for a person with its fake account's details (`TOOL_ACCOUNTS`), as the store does. */
export function addSignIn(
  w: AuthWorld,
  keyring: Keyring,
  userId: string,
  kind: keyof typeof TOOL_ACCOUNTS,
): Promise<SubscriptionView> {
  const input = {
    kind,
    secret: SECRETS[kind],
    label: `${kind} ${randomBytes(2).toString('hex')}`,
    ownerUserId: userId,
  };
  const store = credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
  return store.storeCredential({ ...input, ...TOOL_ACCOUNTS[kind] } as StoreCredentialInput);
}

/** Marks a subscription revoked at its provider, straight in the table. */
export async function revokeSubscription(db: DbHandle, id: string): Promise<void> {
  await rawDb(db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, id));
}

/** A profile of a person's (a Claude one unless `provider` says), straight through the personal layer (no rules checked). */
export async function seedProfile(
  db: DbHandle,
  userId: string,
  values: Partial<Omit<AccessProfile, 'id' | 'ownerUserId'>> = {},
): Promise<AccessProfile> {
  const name = `Profile ${randomBytes(3).toString('hex')}`;
  const [row] = await owned(db, userId)
    .insert(accessProfiles, { name, provider: 'claude', ...values })
    .returning();
  return row as AccessProfile;
}

/** A GitHub or Atlassian profile of a person's, with its tool's default rights unless given (no rules checked). */
export const seedToolProfile = (
  db: DbHandle,
  userId: string,
  provider: ToolProvider,
  values: Partial<Omit<AccessProfile, 'id' | 'ownerUserId' | 'provider'>> = {},
) => seedProfile(db, userId, { provider, rights: defaultRights(provider), ...values });

/** Puts a profile on an agent straight in the table (no rules checked). */
export async function putProfile(db: DbHandle, companyId: string, agentId: string, profileId: string | null) {
  await (await tenant(db, companyId)).update(agents, { profileId }, eq(agents.id, agentId));
}

/** The membership column of each provider's default profile. */
const DEFAULT_FIELDS = { claude: 'defaultClaudeProfileId', openai: 'defaultOpenaiProfileId' } as const;

/** Sets a membership's default profile of a provider (Claude by default) straight in the table (no rules checked). */
export async function putDefault(
  db: DbHandle,
  membershipId: string,
  profileId: string | null,
  provider: AiProvider = 'claude',
) {
  await rawDb(db)
    .update(memberships)
    .set({ [DEFAULT_FIELDS[provider]]: profileId })
    .where(eq(memberships.id, membershipId));
}

/** The profile an agent holds, as stored. */
export const agentProfileOf = async (db: DbHandle, agentId: string) =>
  (await rawDb(db).select().from(agents).where(eq(agents.id, agentId)))[0]?.profileId;

/** The GitHub and Atlassian profiles an agent holds, as stored. */
export async function agentToolsOf(db: DbHandle, agentId: string) {
  const [row] = await rawDb(db).select().from(agents).where(eq(agents.id, agentId));
  return { githubProfileId: row?.githubProfileId, atlassianProfileId: row?.atlassianProfileId };
}

/** The default profile of a provider (Claude by default) a membership holds, as stored. */
export const defaultProfileOf = async (db: DbHandle, membershipId: string, provider: AiProvider = 'claude') =>
  (await rawDb(db).select().from(memberships).where(eq(memberships.id, membershipId)))[0]?.[
    DEFAULT_FIELDS[provider]
  ];

/** One field's audit rows of an entity, oldest first, as `[companyId, action, by, requestId, old, new]`. */
export async function fieldAudit(db: DbHandle, entityType: string, entityId: string, field: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId), eq(auditLog.field, field)),
    )
    .orderBy(asc(auditLog.id));
  return rows.map(
    (row) =>
      [
        row.companyId,
        row.action,
        row.actorPrincipalId ?? row.actorKind,
        row.requestId,
        row.oldValue,
        row.newValue,
      ] as const,
  );
}

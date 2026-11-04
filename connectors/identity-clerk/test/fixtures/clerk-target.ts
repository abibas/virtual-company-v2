import { randomBytes } from 'node:crypto';
import { type ClerkClient, createClerkClient, verifyToken } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { IdentityProvider } from '@mwc/identity-core';
import type { ExternalInvitation } from '@mwc/shared/identity';
import { type AcceptResult, CONTRACT_WEB_ORIGIN, type ContractTarget } from '@mwc/testkit/provider-contract';
import { signedWebhook, testWebhookSecret } from '@mwc/testkit/webhooks';
import { toExternalUser } from '../../src/backend/mappers.ts';
import { type ClerkConfig, clerkConfigFromEnv } from '../../src/config.ts';
import { ClerkIdentityProvider } from '../../src/provider.ts';
import { Fapi } from './fapi.ts';

/** Every object the contract makes in the dev instance starts with this; the leftover check looks for it. */
export const CONTRACT_PREFIX = 'mwc-contract-';

/** What the Clerk-only checks learned during the run, beyond the shared contract. */
export type AzpFinding =
  | { verifiedForOrigin: boolean; refusedForOtherParty: boolean }
  | { unverified: string };

export interface ClerkFindings {
  /** The Frontend API session token of the invitee: verified for our origin, refused for another. */
  azp?: AzpFinding;
}

/** Someone signed in on the Frontend API, as in a browser at our origin. */
export interface FapiSession {
  readonly subject: string;
  /** A fresh session token (they live about a minute); its `azp` is CONTRACT_WEB_ORIGIN. */
  token(): Promise<string>;
}

export interface ClerkContractTarget extends ContractTarget {
  readonly clerk: ClerkClient;
  readonly config: ClerkConfig;
  readonly findings: ClerkFindings;
  /** A Frontend API client with a dev browser (for the instance settings check). */
  fapi(): Promise<Fapi>;
  /**
   * For the S1 acceptance scenario (apps/server): a user `createUser` made signs in with a Backend API sign-in
   * token, and the invitee signs up with the invitation's ticket; both stay signed in. They throw what Clerk said.
   */
  signIn(subject: string): Promise<FapiSession>;
  signUpWithInvitation(invitation: ExternalInvitation): Promise<FapiSession>;
}

function randomId(prefix: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return `${prefix}_${Array.from(randomBytes(27), (byte) => alphabet[byte % alphabet.length]).join('')}`;
}

async function ignoreNotFound(call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
}

/** Every `mwc-contract-` user and organization left in the instance (any run's). */
export async function contractLeftovers(clerk: ClerkClient): Promise<{ users: string[]; orgs: string[] }> {
  const users = await clerk.users.getUserList({ query: CONTRACT_PREFIX, limit: 100 });
  const orgs = await clerk.organizations.getOrganizationList({ query: CONTRACT_PREFIX, limit: 100 });
  return {
    users: users.data
      .filter((u) => u.emailAddresses.some((e) => e.emailAddress.startsWith(CONTRACT_PREFIX)))
      .map((u) => u.id),
    orgs: orgs.data
      .filter((o) => o.name.startsWith(CONTRACT_PREFIX) || o.slug.startsWith(CONTRACT_PREFIX))
      .map((o) => o.id),
  };
}

async function checkAzp(provider: IdentityProvider, token: string, subject: string): Promise<AzpFinding> {
  const ours = await provider.verifyAccessToken(token, { authorizedParties: [CONTRACT_WEB_ORIGIN] });
  const refused = await provider
    .verifyAccessToken(token, { authorizedParties: ['https://another-origin.example'] })
    .then(() => false)
    .catch((error: { code?: string }) => error.code === 'unauthorized');
  return { verifiedForOrigin: ours.subject === subject, refusedForOtherParty: refused };
}

/** One contract run against the instance: its clients, its name, and what it created. */
interface ClerkRun {
  readonly config: ClerkConfig;
  readonly clerk: ClerkClient;
  readonly provider: ClerkIdentityProvider;
  readonly runId: string;
  readonly webhookSecret: string;
  /** Users this run created (deleted by the cleanup). */
  readonly users: Set<string>;
  readonly findings: ClerkFindings;
  email(label: string): string;
}

function startRun(env: Readonly<Record<string, string | undefined>>): ClerkRun {
  const config = clerkConfigFromEnv(env);
  const clerk = createClerkClient({ secretKey: config.secretKey, telemetry: { disabled: true } });
  const webhookSecret = config.webhookSigningSecret ?? testWebhookSecret();
  const provider = new ClerkIdentityProvider({
    backend: { api: clerk, verifyToken, verifyWebhook },
    issuer: config.issuer,
    secretKey: config.secretKey,
    jwtKey: config.jwtKey,
    webhookSigningSecret: webhookSecret,
  });
  const runId = `${CONTRACT_PREFIX}${randomBytes(4).toString('hex')}`;
  const email = (label: string) => `${runId}-${label}+clerk_test@example.com`;
  return { config, clerk, provider, runId, webhookSecret, users: new Set(), findings: {}, email };
}

/** A Frontend API client with a dev browser, past bot protection with a Backend API testing token. */
async function openFapi({ clerk, config }: ClerkRun): Promise<Fapi> {
  const testing = await clerk.testingTokens.createTestingToken().catch(() => undefined);
  const client = new Fapi({
    frontendApi: config.frontendApi,
    origin: CONTRACT_WEB_ORIGIN,
    testingToken: testing?.token,
  });
  const started = await client.start();
  if ('unverified' in started) throw new Error(started.unverified);
  return client;
}

async function createUser(run: ClerkRun, label: string, displayName: string) {
  const [firstName = displayName, ...rest] = displayName.split(' ');
  const user = await run.clerk.users.createUser({
    emailAddress: [run.email(label)],
    firstName,
    ...(rest.length > 0 ? { lastName: rest.join(' ') } : {}),
    skipPasswordRequirement: true,
  });
  run.users.add(user.id);
  return toExternalUser(user);
}

/** The ticket in the invitation's URL (what the emailed link carries), or null. */
async function ticketOf(run: ClerkRun, invitation: ExternalInvitation): Promise<string | null> {
  const { url } = await run.clerk.organizations.getOrganizationInvitation({
    organizationId: invitation.orgExternalId,
    invitationId: invitation.externalId,
  });
  return url ? new URL(url).searchParams.get('__clerk_ticket') : null;
}

const NO_TICKET = 'the Backend API returned the invitation without a ticket URL';

/** The invitee signs up through the invitation's ticket; the sign-up's session token is checked for `azp`. */
async function acceptInvitation(run: ClerkRun, invitation: ExternalInvitation): Promise<AcceptResult> {
  const ticket = await ticketOf(run, invitation);
  if (!ticket) return { unverified: NO_TICKET };
  let client: Fapi;
  try {
    client = await openFapi(run);
  } catch (error) {
    return { unverified: `Frontend API: ${(error as Error).message}` };
  }
  const signedUp = await client.signUpWithTicket(ticket);
  if ('unverified' in signedUp) return { unverified: `Frontend API ${signedUp.unverified}` };
  const { userId, sessionToken } = signedUp.ok;
  run.users.add(userId);
  run.findings.azp = sessionToken
    ? await checkAzp(run.provider, sessionToken, userId)
    : { unverified: 'the sign-up returned no session token' };
  return { subject: userId };
}

/** A session of `client` whose token is asked for afresh each time. */
function fapiSession(client: Fapi, subject: string, sessionId: string): FapiSession {
  return {
    subject,
    async token() {
      const fresh = await client.sessionToken(sessionId);
      if ('unverified' in fresh) throw new Error(`Frontend API ${fresh.unverified}`);
      return fresh.ok;
    },
  };
}

/** The invitee signs up with the invitation's ticket (accepting it) and stays signed in. */
async function signUpWithInvitation(run: ClerkRun, invitation: ExternalInvitation): Promise<FapiSession> {
  const ticket = await ticketOf(run, invitation);
  if (!ticket) throw new Error(NO_TICKET);
  const client = await openFapi(run);
  const signedUp = await client.signUpWithTicket(ticket);
  if ('unverified' in signedUp) throw new Error(`Frontend API ${signedUp.unverified}`);
  run.users.add(signedUp.ok.userId);
  if (!signedUp.ok.sessionId) throw new Error('Frontend API: the sign-up returned no session');
  return fapiSession(client, signedUp.ok.userId, signedUp.ok.sessionId);
}

/** A user of this run signs in on the Frontend API with a sign-in token (10 minutes), as the web's sign-in would. */
async function signIn(run: ClerkRun, subject: string): Promise<FapiSession> {
  const { token } = await run.clerk.signInTokens.createSignInToken({
    userId: subject,
    expiresInSeconds: 600,
  });
  const client = await openFapi(run);
  const signedIn = await client.signInWithTicket(token);
  if ('unverified' in signedIn) throw new Error(`Frontend API ${signedIn.unverified}`);
  return fapiSession(client, subject, signedIn.ok.sessionId);
}

/** Deletes the run's organizations (with their memberships and invitations), then its users. */
async function cleanup({ clerk, runId, users }: ClerkRun): Promise<void> {
  const orgs = await clerk.organizations.getOrganizationList({ query: runId, limit: 100 });
  for (const org of orgs.data) await ignoreNotFound(() => clerk.organizations.deleteOrganization(org.id));
  const found = await clerk.users.getUserList({ query: runId, limit: 100 });
  for (const user of found.data) users.add(user.id);
  for (const id of users) await ignoreNotFound(() => clerk.users.deleteUser(id));
}

/**
 * The real Clerk development instance as a contract target. Users are created with the Backend API
 * (`+clerk_test` emails, no password), tokens are Backend API session tokens (no `azp`), the invitee
 * signs up through the invitation's ticket on the Frontend API, and webhooks are signed with the
 * instance's signing secret or a test one. `cleanup` deletes this run's organizations and users.
 */
export function clerkContractTarget(env: Readonly<Record<string, string | undefined>>): ClerkContractTarget {
  const run = startRun(env);
  const { clerk } = run;
  return {
    provider: run.provider,
    runId: run.runId,
    clerk,
    config: run.config,
    findings: run.findings,
    fapi: () => openFapi(run),
    email: run.email,
    createUser: (label, displayName) => createUser(run, label, displayName),
    async mintToken(subject) {
      const session = await clerk.sessions.createSession({ userId: subject });
      const { jwt } = await clerk.sessions.getToken(session.id);
      // A Backend API session token has no `azp`; Clerk refuses it when parties are given.
      return { token: jwt, authorizedParties: [] };
    },
    missing: { subject: randomId('user'), org: randomId('org'), invitation: randomId('orginv') },
    acceptInvitation: (invitation) => acceptInvitation(run, invitation),
    signIn: (subject) => signIn(run, subject),
    signUpWithInvitation: (invitation) => signUpWithInvitation(run, invitation),
    signedUserDeleted: (subject) =>
      signedWebhook(
        {
          type: 'user.deleted',
          object: 'event',
          data: { object: 'user', id: subject, deleted: true },
          timestamp: Date.now(),
        },
        run.webhookSecret,
      ),
    cleanup: () => cleanup(run),
  };
}

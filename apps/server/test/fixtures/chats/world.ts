/**
 * The chats tests' world (S5.1b): the machines' world (a real runner socket, `FakeRunner`) with one keyring the app and
 * the tests seal subscriptions under and a fake AI provider for the logins' refreshes; a scene of a company with an
 * agent placed on an online machine, an access profile holding a subscription of the kind asked for, and a chat; the
 * runner's side of a turn (its `turn.start`, events, end); and the rows a turn leaves.
 */
import {
  type AccessProfile,
  agents,
  chatEvents,
  chats,
  chatTurns,
  credentialUses,
  type DbHandle,
  tenant,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { GatewayProvider } from '@mwc/shared/credentials';
import type { CredentialKind, Effort, Harness } from '@mwc/shared/enums';
import type { TurnEvent } from '@mwc/shared/harness';
import type { RunnerCaps, TurnEnd, TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { asc, eq } from 'drizzle-orm';
import type { ChatView } from '../../../src/modules/chats/schemas.ts';
import { credentialSecrets } from '../../../src/modules/credentials/index.ts';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { ephemeralKeyring, type Keyring } from '../../../src/platform/secrets/keyring.ts';
import { FakeProvider } from '../credentials/providers.ts';
import { enroll } from '../machines/machines.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../members/members.ts';
import { addSubscription, agentsPath, makeAgent, seedProfile } from '../org.ts';
import type { Person } from '../platform/auth.ts';

export { eventually };

export interface ChatsWorld extends MachinesWorld {
  readonly keyring: Keyring;
  readonly provider: FakeProvider;
}

export async function chatsWorld(): Promise<ChatsWorld> {
  const keyring = ephemeralKeyring();
  const provider = new FakeProvider();
  const w = await machinesWorld({}, { keyring, providerFetch: provider.fetch });
  return { ...w, keyring, provider };
}

export const agentChatsPath = (company: Pick<MembersCompany, 'companyId'>, agentId: string) =>
  `${agentsPath(company, agentId)}/chats`;

export const chatPath = (company: Pick<MembersCompany, 'companyId'>, chatId: string, rest = '') =>
  `/api/companies/${company.companyId}/chats/${chatId}${rest}`;

/** Both CLIs, with their versions, and a terminal. */
export const BOTH_HARNESSES: Partial<RunnerCaps> = {
  harnesses: { claude_code: '2.1.319 (Claude Code)', codex: 'codex-cli 0.163.0' },
  terminal: true,
};

export const HOME = '/Users/ihor/agents/slop-box';

export interface SceneOptions {
  readonly harness?: Harness;
  /** The kind of the subscription in the harness's slot; none leaves the slot empty. */
  readonly kind?: CredentialKind | null;
  /** A gateway of the profile's provider in the profile too. */
  readonly gateway?: boolean;
  readonly caps?: Partial<RunnerCaps>;
  /** No runner connected. */
  readonly offline?: boolean;
  /** The placement's permission policy and configuration folder. */
  readonly permissionPolicy?: 'ask' | 'bypass';
  readonly configDir?: string | null;
  /** What the profile runs (stored as it is, no rules checked): Opus 5.5 (GPT-6.1 Sol for Codex) at high by default. */
  readonly model?: string | null;
  readonly effort?: Effort | null;
}

export interface Scene {
  readonly company: MembersCompany;
  readonly machineId: string;
  readonly runnerKey: string;
  readonly runner: FakeRunner | undefined;
  readonly agentId: string;
  readonly profile: AccessProfile;
  readonly credential: SubscriptionView | undefined;
  readonly chat: ChatView;
}

/** Puts the agent on the machine, in host mode, through the API (the test fails on anything but a 200). */
export async function place(
  w: MachinesWorld,
  company: MembersCompany,
  agentId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await as(w, company.owner)('PUT', `${agentsPath(company, agentId)}/placement`, {
    mode: 'host',
    home: HOME,
    permissionPolicy: 'ask',
    ...body,
  });
  if (res.status !== 200)
    throw new Error(`PUT placement answered ${res.status}: ${JSON.stringify(res.body)}`);
}

/** Begins a chat as `person` (the owner by default); the test fails on anything but a 201. */
export async function beginChat(
  w: MachinesWorld,
  company: MembersCompany,
  agentId: string,
  body: Record<string, unknown> = {},
  person: Person = company.owner,
): Promise<ChatView> {
  const res = await as(w, person)('POST', agentChatsPath(company, agentId), body);
  if (res.status !== 201) throw new Error(`POST chats answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as ChatView;
}

/** A gateway of a person's (for Claude Code unless `provider` says), with its address, sealed as the store does. */
export function addGateway(
  w: ChatsWorld,
  userId: string,
  provider: GatewayProvider = 'anthropic',
): Promise<SubscriptionView> {
  return credentialSecrets({ db: w.t.db, keyring: w.keyring, clock: w.clock }).storeCredential({
    kind: 'gateway',
    secret: { headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' } },
    label: 'Gateway',
    ownerUserId: userId,
    accountMeta: { baseUrl: GATEWAY_URL, provider },
  });
}

export const GATEWAY_URL = 'https://gateway.example.test/v1';

/** A company with an agent placed on an online machine, its access profile (see `SceneOptions`), and a chat. */
export async function scene(w: ChatsWorld, options: SceneOptions = {}): Promise<Scene> {
  const harness = options.harness ?? 'claude_code';
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company);
  const runner = options.offline
    ? undefined
    : await w.connect(runnerKey, { caps: { ...BOTH_HARNESSES, ...options.caps } });
  const agent = await makeAgent(w, company, company.owner, { harness });
  const configDir = options.configDir ?? null;
  await place(w, company, agent.id, {
    machineId,
    permissionPolicy: options.permissionPolicy ?? 'ask',
    configDir,
  });
  const kind =
    options.kind === undefined ? (harness === 'codex' ? 'codex_oauth' : 'claude_setup_token') : options.kind;
  const credential =
    kind === null ? undefined : await addSubscription(w, w.keyring, company.owner.userId, kind);
  const gatewayProvider = harness === 'codex' ? 'openai' : 'anthropic';
  const gateway = options.gateway ? await addGateway(w, company.owner.userId, gatewayProvider) : undefined;
  const profile = await seedProfile(w.t.db, company.owner.userId, {
    provider: harness === 'codex' ? 'openai' : 'claude',
    credentialId: credential?.id ?? null,
    gatewayCredentialId: gateway?.id ?? null,
    model:
      options.model === undefined ? (harness === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5') : options.model,
    effort: options.effort === undefined ? 'high' : options.effort,
  });
  await (await tenant(w.t.db, company.companyId)).update(
    agents,
    { profileId: profile.id },
    eq(agents.id, agent.id),
  );
  const chat = await beginChat(w, company, agent.id);
  return { company, machineId, runnerKey, runner, agentId: agent.id, profile, credential, chat };
}

/** Sends a prompt as `person` (the owner by default): the status and the body. */
export const sendPrompt = (
  w: MachinesWorld,
  s: Pick<Scene, 'company' | 'chat'>,
  prompt: string,
  person?: Person,
) => as(w, person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), { prompt });

/** A prompt sent and its `turn.start` as the runner got it. */
export async function startedTurn(w: MachinesWorld, s: Scene, prompt = 'What is 2 + 2?'): Promise<TurnStart> {
  const res = await sendPrompt(w, s, prompt);
  if (res.status !== 202) throw new Error(`POST turns answered ${res.status}: ${JSON.stringify(res.body)}`);
  return (s.runner as FakeRunner).frames.next('turn.start');
}

/** The runner sends events, numbered from `from`. */
export function sendEvents(runner: FakeRunner, turnId: string, events: readonly TurnEvent[], from = 1): void {
  runner.send({ type: 'turn.events', turnId, events: events.map((event, i) => ({ seq: from + i, event })) });
}

/** The runner ends the turn (ok, exit 0, unless `fields` say otherwise). */
export function endTurn(
  runner: FakeRunner,
  turnId: string,
  fields: Partial<Omit<TurnEnd, 'type'>> = {},
): void {
  runner.send({ type: 'turn.end', turnId, ok: true, exitCode: 0, ...fields });
}

/** A whole answer: the session, the reply, the usage and the result. */
export const ANSWER: TurnEvent[] = [
  { type: 'session', sessionId: 'b4c1f0e2-session' },
  { type: 'text', text: '4' },
  { type: 'usage', inputTokens: 12, outputTokens: 1, costUsd: 0.001 },
  { type: 'result', ok: true, text: '4', durationMs: 900 },
];

export const turnRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(chatTurns).where(eq(chatTurns.id, id)))[0];

export const chatRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(chats).where(eq(chats.id, id)))[0];

export const eventRows = (db: DbHandle, turnId: string) =>
  rawDb(db).select().from(chatEvents).where(eq(chatEvents.turnId, turnId)).orderBy(asc(chatEvents.seq));

/** Every recorded use of a credential, oldest first. */
export const usesOf = (db: DbHandle, credentialId: string) =>
  rawDb(db)
    .select()
    .from(credentialUses)
    .where(eq(credentialUses.credentialId, credentialId))
    .orderBy(asc(credentialUses.id));

/** Waits until the turn's row has ended. */
export async function ended(db: DbHandle, turnId: string) {
  await eventually('the turn ended', async () => (await turnRow(db, turnId))?.endedAt != null);
  return turnRow(db, turnId);
}

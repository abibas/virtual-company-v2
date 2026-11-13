import { type AccessProfile, type Agent, type AiPartRow, aiPartOf, type Chat, type TenantDb } from '@mwc/db';
import { type GatewayRoute, gatewayRouteOf, HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import type { HarnessCredential, HarnessGateway, TerminalSpec } from '@mwc/shared/harness';
import { policyOfMode } from '@mwc/shared/modes';
import { roleAtLeast } from '@mwc/shared/roles';
import { harnessVersionOf } from '@mwc/shared/runner-protocol';
import type { CredentialsForHarness, HarnessUse } from '../../credentials/index.ts';
import { agentPlacement, type RunnerHub } from '../../machines/index.ts';
import { profilePartMissing } from '../../org/rules/agents.ts';
import { profilesRepo } from '../repo/profiles.ts';
import { chatsRepo } from '../repo.ts';
import { BRANCH_PENDING, RUNNER_CANNOT_FORK } from '../rules/branch.ts';
import { turnRuns } from '../rules/overrides.ts';
import {
  CONTAINER_RUNS_LATER,
  HARNESS_CHANGED,
  harnessMissing,
  MACHINE_CHANGED,
  MACHINE_OFFLINE,
  PLACEMENT_MISSING,
  PROFILE_MISSING,
  PROFILE_OWNER_GONE,
  profileEmpty,
  type Refusal,
  RUNNER_OUTDATED,
  TERMINAL_UNAVAILABLE,
  turnEffort,
  turnModel,
} from '../rules.ts';
import { forkOf, type TurnFork } from './branch.ts';

/**
 * Where and on what a chat's turn or terminal runs (S5.1b, docs/harness.md "How a turn runs"): the agent (its harness
 * must still be the chat's), its placement (on its machine, in host mode, on the chat's machine), the machine's runner
 * (connected, with the harness's CLI, and a terminal for a terminal), the access profile (the chat's own while its owner
 * is still an admin here, else the agent's; of the provider the harness runs on) and its subscription, opened as its
 * owner (a `credential_uses` row) and refreshed when due, with the profile's gateway (any of its owner's: its address
 * with the path of the harness and, for Codex, of the credential's kind, `gatewayRouteOf`) and the profile's model and
 * effort (since 2026-11-10; none: the harness's own default) and permission mode (since 2026-11-13), each the chat's own
 * instead in a message chat that sets one (`turnRuns`). A
 * branch not forked yet (`fork_pending`) opens no terminal, and its turn needs a runner that forks and says how to fork
 * (`forkOf`). The spec carries the agent's standing instructions, read from the live chart each time, so a move on the
 * chart reaches the chat's next turn (docs/harness.md, "Standing instructions"). Read before anything is written; each
 * refusal names what to fix.
 */

/**
 * What resolving needs: the hub, the credentials module's side, and the org module's standing instructions of an agent
 * (its place in the company now, then its own instructions: `standingReader`).
 */
export interface TargetDeps {
  readonly hub: RunnerHub;
  readonly credentials: CredentialsForHarness;
  readonly standing: (t: TenantDb, agent: Agent) => Promise<string>;
}

/** A resolved turn or terminal: the session's spec (without a prompt), a turn's fork, the subscription it runs on. */
export interface Target {
  readonly ok: true;
  readonly agent: Agent;
  readonly spec: TerminalSpec;
  /** What a branch's first turn adds to its spec (`forkSession`, `resumeAt`); empty otherwise. */
  readonly fork: TurnFork;
  readonly profileId: string;
  readonly credentialId: string;
  readonly ownerUserId: string;
  readonly kind: CredentialKind;
  /** True when the machine's runner offers the agents' tools (S6a, `caps.agentTools`). */
  readonly agentTools: boolean;
  /** True when it lists and relays the server's own tools (S7.1c, `caps.serverTools`). */
  readonly serverTools: boolean;
  /** True when its turns take a GitHub sign-in for git and gh (S7.1d, `caps.github`). */
  readonly github: boolean;
  /** Who asked: the principal the turn's uses of credentials are recorded for. */
  readonly by: string;
}

/** Who asks, and for what. */
export interface TargetRequest {
  readonly principalId: string;
  readonly purpose: HarnessUse['purpose'];
}

/** The agent, its placement and its runner, or why the chat cannot run there now. */
async function placeOf(deps: TargetDeps, t: TenantDb, chat: Chat, terminal: boolean) {
  const agent = (await chatsRepo.agentOf(t, chat.agentId)) as Agent;
  if (agent.harness !== chat.harness) return HARNESS_CHANGED;
  const result = await agentPlacement(t, agent.id);
  const placement = result.ok ? result.placement : null;
  if (placement === null) return PLACEMENT_MISSING;
  if (placement.mode === 'container') return CONTAINER_RUNS_LATER;
  if (placement.machineId !== chat.machineId) return MACHINE_CHANGED;
  const runner = deps.hub.connected(placement.machineId);
  if (runner === undefined || runner.companyId !== t.companyId) return MACHINE_OFFLINE;
  const version = harnessVersionOf(runner.caps.harnesses, chat.harness);
  if (version === undefined) return RUNNER_OUTDATED;
  if (version === null) return harnessMissing(chat.harness);
  if (terminal && !runner.caps.terminal) return TERMINAL_UNAVAILABLE;
  if (chat.forkPending && !runner.caps.forks) return RUNNER_CANNOT_FORK;
  const { caps } = runner;
  return {
    ok: true as const,
    agent,
    placement,
    agentTools: caps.agentTools === true,
    serverTools: caps.serverTools,
    github: caps.github === true,
  };
}

/** The profile the chat runs on: its own while the person who chose it is still an admin here, else the agent's. */
async function profileOf(t: TenantDb, chat: Chat, agent: Agent): Promise<AccessProfile | Refusal<422>> {
  if (chat.profileId !== null) {
    const setter = await profilesRepo.membershipOf(t, chat.profileSetBy as string);
    if (setter?.status !== 'active' || !roleAtLeast(setter.role, 'admin')) return PROFILE_OWNER_GONE;
  }
  const profileId = chat.profileId ?? agent.profileId;
  const profile = profileId === null ? undefined : await profilesRepo.get(t, profileId);
  return profile ?? PROFILE_MISSING;
}

/** The part's gateway as the turn's route reaches it, or null for none. */
async function gatewayOf(
  deps: TargetDeps,
  owned: { readonly profile: AccessProfile; readonly part: AiPartRow },
  use: HarnessUse,
  route: GatewayRoute,
): Promise<{ readonly ok: true; readonly gateway: HarnessGateway | null } | Refusal<422 | 503>> {
  const { profile, part } = owned;
  if (part.gatewayCredentialId === null) return { ok: true, gateway: null };
  const opened = await deps.credentials.gateway(part.gatewayCredentialId, profile.ownerUserId, use, route);
  return opened.ok ? { ok: true, gateway: opened.gateway } : opened;
}

/** Resolves a chat's turn or terminal (see above). */
export async function resolveTarget(
  deps: TargetDeps,
  t: TenantDb,
  chat: Chat,
  request: TargetRequest,
): Promise<Target | Refusal> {
  const terminal = request.purpose === 'chat_terminal';
  if (terminal && chat.forkPending) return BRANCH_PENDING;
  const place = await placeOf(deps, t, chat, terminal);
  if (!place.ok) return place;
  const { agent, placement } = place;
  const forked = await forkOf(t, chat);
  if (!forked.ok) return forked;
  const profile = await profileOf(t, chat, agent);
  if (!('id' in profile)) return profile;
  const provider = HARNESS_PROVIDER[chat.harness];
  const part = aiPartOf(profile, provider);
  if (part === undefined) return profilePartMissing(chat.harness);
  const { credentialId } = part;
  if (credentialId === null) return profileEmpty(profile.name);
  const instructions = await deps.standing(t, agent);
  const use: HarnessUse = {
    purpose: request.purpose,
    companyId: t.companyId,
    agentId: agent.id,
    chatId: chat.id,
    principalId: request.principalId,
  };
  const opened = await deps.credentials.credential(credentialId, profile.ownerUserId, use);
  if (!opened.ok) return opened;
  const credential: HarnessCredential = opened.credential;
  const gateway = await gatewayOf(
    deps,
    { profile, part },
    use,
    gatewayRouteOf(chat.harness, credential.kind),
  );
  if (!gateway.ok) return gateway;
  const runs = turnRuns(chat, provider, part);
  const spec: TerminalSpec = {
    harness: chat.harness,
    cwd: placement.home,
    sessionId: chat.sessionId,
    model: turnModel(chat.harness, runs.model),
    effort: turnEffort(chat.harness, runs.effort),
    permissionPolicy: policyOfMode(runs.mode),
    permissionMode: runs.mode,
    configDir: placement.configDir,
    credential,
    gateway: gateway.gateway,
    instructions,
  };
  return {
    ok: true,
    agent,
    spec,
    fork: forked.fork,
    profileId: profile.id,
    credentialId,
    ownerUserId: profile.ownerUserId,
    kind: credential.kind,
    agentTools: place.agentTools,
    serverTools: place.serverTools,
    github: place.github,
    by: request.principalId,
  };
}

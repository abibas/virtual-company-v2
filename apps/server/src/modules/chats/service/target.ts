import type { AccessProfile, Agent, Chat, TenantDb } from '@mwc/db';
import type { CredentialKind } from '@mwc/shared/enums';
import type { HarnessCredential, HarnessGateway, TerminalSpec } from '@mwc/shared/harness';
import { roleAtLeast } from '@mwc/shared/roles';
import { harnessVersionOf } from '@mwc/shared/runner-protocol';
import type { CredentialsForHarness, HarnessUse } from '../../credentials/index.ts';
import { agentPlacement, type RunnerHub } from '../../machines/index.ts';
import { profilesRepo } from '../repo/profiles.ts';
import { chatsRepo } from '../repo.ts';
import {
  CONTAINER_RUNS_LATER,
  HARNESS_CHANGED,
  HARNESS_SLOT,
  harnessMissing,
  MACHINE_CHANGED,
  MACHINE_OFFLINE,
  PLACEMENT_MISSING,
  PROFILE_MISSING,
  PROFILE_OWNER_GONE,
  profileSlotEmpty,
  type Refusal,
  RUNNER_OUTDATED,
  TERMINAL_UNAVAILABLE,
} from '../rules.ts';

/**
 * Where and on what a chat's turn or terminal runs (S5.1b, docs/harness.md "How a turn runs"): the agent (its harness
 * must still be the chat's), its placement (on its machine, in host mode, on the chat's machine), the machine's runner
 * (connected, with the harness's CLI, and a terminal for a terminal), the access profile (the chat's own while its owner
 * is still an admin here, else the agent's) and the subscription in the harness's slot, opened as its owner (a
 * `credential_uses` row) and refreshed when due, with the profile's gateway for Claude Code. Read before anything is
 * written; each refusal names what to fix.
 */

/** What resolving needs: the hub and the credentials module's side. */
export interface TargetDeps {
  readonly hub: RunnerHub;
  readonly credentials: CredentialsForHarness;
}

/** A resolved turn or terminal: the session's spec (without a prompt) and the subscription it runs on. */
export interface Target {
  readonly ok: true;
  readonly agent: Agent;
  readonly spec: TerminalSpec;
  readonly profileId: string;
  readonly credentialId: string;
  readonly ownerUserId: string;
  readonly kind: CredentialKind;
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
  return { ok: true as const, agent, placement };
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

/** The profile's gateway for the harness: Claude Code's as it is, Codex's address alone (it runs without it). */
async function gatewayOf(
  deps: TargetDeps,
  chat: Chat,
  profile: AccessProfile,
  use: HarnessUse,
): Promise<{ readonly ok: true; readonly gateway: HarnessGateway | null } | Refusal<422 | 503>> {
  if (profile.gatewayCredentialId === null) return { ok: true, gateway: null };
  const opened = await deps.credentials.gateway(profile.gatewayCredentialId, profile.ownerUserId, use);
  if (!opened.ok) return opened;
  const gateway =
    chat.harness === 'codex' ? { baseUrl: opened.gateway.baseUrl, headers: {} } : opened.gateway;
  return { ok: true, gateway };
}

/** Resolves a chat's turn or terminal (see above). */
export async function resolveTarget(
  deps: TargetDeps,
  t: TenantDb,
  chat: Chat,
  request: TargetRequest,
): Promise<Target | Refusal> {
  const place = await placeOf(deps, t, chat, request.purpose === 'chat_terminal');
  if (!place.ok) return place;
  const { agent, placement } = place;
  const profile = await profileOf(t, chat, agent);
  if (!('id' in profile)) return profile;
  const slot = HARNESS_SLOT[chat.harness];
  const credentialId = slot === 'claude' ? profile.claudeCredentialId : profile.openaiCredentialId;
  if (credentialId === null) return profileSlotEmpty(slot);
  const use: HarnessUse = {
    purpose: request.purpose,
    companyId: t.companyId,
    agentId: agent.id,
    chatId: chat.id,
    principalId: request.principalId,
  };
  const opened = await deps.credentials.credential(credentialId, profile.ownerUserId, use);
  if (!opened.ok) return opened;
  const gateway = await gatewayOf(deps, chat, profile, use);
  if (!gateway.ok) return gateway;
  const credential: HarnessCredential = opened.credential;
  const spec: TerminalSpec = {
    harness: chat.harness,
    cwd: placement.home,
    sessionId: chat.sessionId,
    model: agent.model,
    effort: agent.effort,
    permissionPolicy: placement.permissionPolicy,
    configDir: placement.configDir,
    credential,
    gateway: gateway.gateway,
  };
  return {
    ok: true,
    agent,
    spec,
    profileId: profile.id,
    credentialId,
    ownerUserId: profile.ownerUserId,
    kind: credential.kind,
  };
}

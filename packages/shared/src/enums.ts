import { z } from 'zod';

/**
 * Enums stored as `text` columns with a CHECK constraint (`@mwc/db` builds the CHECK from
 * `.options`), so the database and the API accept exactly the same values.
 */

/** `companies.status`: provisioning until the identity provider has the organization. */
export const CompanyStatus = z.enum(['provisioning', 'active', 'suspended', 'deleted']);
export type CompanyStatus = z.infer<typeof CompanyStatus>;

/** `users.status`: a deactivated user keeps their rows but cannot sign in. */
export const UserStatus = z.enum(['active', 'deactivated']);
export type UserStatus = z.infer<typeof UserStatus>;

/** `audit_log.actor_kind`: who made a change (a person, an agent, the system, the identity provider). */
export const ActorKind = z.enum(['user', 'agent', 'system', 'identity']);
export type ActorKind = z.infer<typeof ActorKind>;

/** `principals.kind`: the one id space every actor and assignee points to, a person or an agent. */
export const PrincipalKind = z.enum(['person', 'agent']);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

/** `memberships.role` and `granted_role`: what a person may do in one company. Only a local decision makes an owner. */
export const MembershipRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export type MembershipRole = z.infer<typeof MembershipRole>;

/** `memberships.status`: `removed` ends access at once and is never undone by the provider alone. */
export const MembershipStatus = z.enum(['invited', 'active', 'suspended', 'removed']);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

/** `invitations.status`; `failed` is local only (the provider never accepted the invitation). */
export const InvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired', 'failed']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

/** `api_keys.kind`: a person's own key, a runner's key (bound to a machine), a company's SCIM bearer. */
export const ApiKeyKind = z.enum(['personal', 'runner', 'scim']);
export type ApiKeyKind = z.infer<typeof ApiKeyKind>;

/** `identity_events.type`: every normalized identity event type (`@mwc/shared/identity`). */
export const IdentityEventType = z.enum([
  'user.upserted',
  'user.deleted',
  'org.upserted',
  'org.deleted',
  'membership.upserted',
  'membership.deleted',
  'invitation.accepted',
  'invitation.revoked',
]);
export type IdentityEventType = z.infer<typeof IdentityEventType>;

/**
 * `identity_events.type`: a normalized event type, or `ignored` for a verified delivery of a provider event type
 * this product does not project (recorded once so a replay stays a no-op, never projected).
 */
export const IdentityInboxType = z.enum([...IdentityEventType.options, 'ignored']);
export type IdentityInboxType = z.infer<typeof IdentityInboxType>;

/**
 * `identity_events.status`: the webhook and SCIM inbox. `pending` until its first try ends, `processed` once
 * projected (or ignored), `failed` after a try that failed: `next_attempt_at` says when the next try is due, and is
 * null once the event is given up after its last try.
 */
export const IdentityEventStatus = z.enum(['pending', 'processed', 'failed']);
export type IdentityEventStatus = z.infer<typeof IdentityEventStatus>;

/** `identity_outbox.op`: the provider calls made after a local change (local first, then the provider). */
export const IdentityOutboxOp = z.enum([
  'create_org',
  'invite',
  'revoke_invite',
  'update_role',
  'remove_member',
  'delete_org',
]);
export type IdentityOutboxOp = z.infer<typeof IdentityOutboxOp>;

/** `identity_outbox.status`: pending (also while waiting for a retry), done, or failed for good. */
export const IdentityOutboxStatus = z.enum(['pending', 'done', 'failed']);
export type IdentityOutboxStatus = z.infer<typeof IdentityOutboxStatus>;

/** `company_logos.content_type`: the image types a company logo may be, told from the file's own first bytes. */
export const LogoContentType = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export type LogoContentType = z.infer<typeof LogoContentType>;

/** `agents.status`: a paused agent starts no runs; an archived one has left the org chart. */
export const AgentStatus = z.enum(['active', 'paused', 'archived']);
export type AgentStatus = z.infer<typeof AgentStatus>;

/** `agents.harness`: the coding harness an agent's runs use. */
export const Harness = z.enum(['claude_code', 'codex']);
export type Harness = z.infer<typeof Harness>;

/** `agents.effort`: the reasoning effort the harness runs the agent's model with. */
export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

/**
 * `credentials.kind`: what a person's subscription is (docs/subscriptions.md). The two logins are written by the sign-in
 * helper (S3.2); the other four are pasted.
 */
export const CredentialKind = z.enum([
  'claude_oauth',
  'claude_setup_token',
  'codex_oauth',
  'anthropic_api_key',
  'openai_api_key',
  'gateway',
]);
export type CredentialKind = z.infer<typeof CredentialKind>;

/** `credentials.status`: usable, its login has to be signed in again, or revoked at the provider. */
export const CredentialStatus = z.enum(['active', 'needs_sign_in', 'revoked']);
export type CredentialStatus = z.infer<typeof CredentialStatus>;

/** `machines.kind` (docs/machines.md): This Mac or another laptop, a VM such as the Airia devbox, a Docker container. */
export const MachineKind = z.enum(['laptop', 'vm', 'container']);
export type MachineKind = z.infer<typeof MachineKind>;

/** `machines.provider`: what can power a machine on and off; `none` when nothing can (a laptop, a container). */
export const MachineProvider = z.enum(['none', 'airia_devbox']);
export type MachineProvider = z.infer<typeof MachineProvider>;

/** `machines.status`: its runner is connected, is not, or is connected but takes no new runs. */
export const MachineStatus = z.enum(['online', 'offline', 'draining']);
export type MachineStatus = z.infer<typeof MachineStatus>;

/**
 * `machines.hold_source` and `hold.state`'s `source`: what set a runner's hold, the server's `machine.hold` or the
 * runner itself while runs are live.
 */
export const HoldSource = z.enum(['server', 'live_runs']);
export type HoldSource = z.infer<typeof HoldSource>;

/** `machine_power_events.action`: every power decision and its outcome, as a machine's log shows them. */
export const PowerEventAction = z.enum([
  'started',
  'stopped',
  'held',
  'released',
  'kept',
  'policy',
  'timezone',
  'failed',
]);
export type PowerEventAction = z.infer<typeof PowerEventAction>;

/**
 * `agent_placements.mode` (docs/subscriptions.md, "Where agents live"): its runs work in a folder on the machine as the
 * machine's user (`host`), or in a fresh locked-down container per run (`container`).
 */
export const PlacementMode = z.enum(['host', 'container']);
export type PlacementMode = z.infer<typeof PlacementMode>;

/** `agent_placements.permission_policy`: its runs ask a person before a tool outside their rules, or skip the prompts. */
export const PermissionPolicy = z.enum(['ask', 'bypass']);
export type PermissionPolicy = z.infer<typeof PermissionPolicy>;

/**
 * `chat_turns.status` (S5.1b, docs/harness.md): a chat turn waiting in the chat's queue for the running one to end
 * (`queued`, S5.2 step 6), its process running there (`running`), and how it ended: with its result (`done`), failed or
 * refused (`failed`), or stopped by a person (`stopped`).
 */
export const ChatTurnStatus = z.enum(['queued', 'running', 'done', 'failed', 'stopped']);
export type ChatTurnStatus = z.infer<typeof ChatTurnStatus>;

/**
 * `chat_turns.kind` (S5.2, docs/harness.md "Compact and Clear"): a person's prompt (`message`), the harness's own
 * `/compact` of the conversation (`compact`), or a Clear, which runs no process and starts the next turn in a new
 * conversation (`clear`).
 */
export const ChatTurnKind = z.enum(['message', 'compact', 'clear']);
export type ChatTurnKind = z.infer<typeof ChatTurnKind>;

/**
 * `chat_turns.delivery` (S5.2 step 6, docs/harness.md "Delivery while a turn runs"): how a message sent while the agent
 * worked was to reach it: into the running turn (`now`; Claude Code only, the turn takes it at its next step), as the
 * next turn once the running one ends (`after`), or by stopping the running turn and starting next (`interrupt`). Null
 * for a turn that started at once.
 */
export const ChatTurnDelivery = z.enum(['now', 'after', 'interrupt']);
export type ChatTurnDelivery = z.infer<typeof ChatTurnDelivery>;

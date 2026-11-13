import { ACCESS_PROFILE_NAME, CREDENTIAL_LABEL, CREDENTIAL_PURPOSE } from '@mwc/shared/credentials';
import {
  CredentialKind,
  CredentialStatus,
  Effort,
  ProfileProvider,
  ToolCheckError,
  type ToolProvider,
} from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { MODEL_ID_MAX } from '@mwc/shared/models';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, oneOf, updatedAt } from './columns.ts';
import { users } from './users.ts';

/** A number written into a CHECK as it is (the limits come from `@mwc/shared/credentials`, which the API reads too). */
const n = (value: number) => sql.raw(String(value));

/** `char_length(<column>) between <min> and <max>`. */
const lengthWithin = (column: AnyPgColumn, range: { readonly min: number; readonly max: number }) =>
  sql`char_length(${column}) between ${n(range.min)} and ${n(range.max)}`;

/**
 * Personal credentials (S3.1, docs/subscriptions.md): a person's subscriptions, API keys and gateways, and since S7.1a
 * their tool sign-ins (GitHub, Atlassian). A personal table, owned by a user and never by a company, so it has no
 * `company_id`; code reaches it only through `owned(db, userId)` of `@mwc/db`, which scopes every statement to its owner.
 *
 * The secret is sealed by the server with AES-256-GCM (`key_version` names the master key, `iv` is 12 random bytes per
 * seal, `auth_tag` 16 bytes) and the additional data `credential|<id>|<owner_user_id>|<kind>`, so a row copied onto
 * another id, owner or kind does not open. Everything else is metadata the API shows: never a secret
 * (`account_meta`: plan, organization, scopes, a gateway's address and its own paths).
 */
export const credentials = pgTable(
  'credentials',
  {
    /** Chosen by the server before sealing: the additional data names it. */
    id: uuid('id').primaryKey().$defaultFn(newId),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').$type<CredentialKind>().notNull(),
    /** What its owner calls it ("Max at home"). */
    label: text('label').notNull(),
    /** The provider account the login belongs to, when it says. */
    accountEmail: text('account_email'),
    accountMeta: jsonb('account_meta').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<CredentialStatus>().notNull().default('active'),
    keyVersion: integer('key_version').notNull(),
    iv: bytea('iv').notNull(),
    authTag: bytea('auth_tag').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** The last time the server opened the secret (a usage check, later a run). */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /**
     * A tool sign-in's last check with its provider (S7.1a: when it was added or signed in again, Check again, and the
     * daily check); null for the AI kinds, whose limits checks live in the server's memory.
     */
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    /** Why that check did not finish (`ToolCheckError`); null when it worked or set the sign-in `needs_sign_in`. */
    checkError: text('check_error').$type<ToolCheckError>(),
  },
  (t) => [
    check('credentials_kind_check', oneOf(t.kind, CredentialKind.options)),
    check('credentials_status_check', oneOf(t.status, CredentialStatus.options)),
    check('credentials_label_check', lengthWithin(t.label, CREDENTIAL_LABEL)),
    check('credentials_key_version_check', sql`${t.keyVersion} >= 1`),
    check('credentials_iv_check', sql`octet_length(${t.iv}) = 12`),
    check('credentials_auth_tag_check', sql`octet_length(${t.authTag}) = 16`),
    check('credentials_account_meta_check', sql`jsonb_typeof(${t.accountMeta}) = 'object'`),
    check('credentials_check_error_check', oneOf(t.checkError, ToolCheckError.options)),
    index('credentials_owner_idx').on(t.ownerUserId, t.createdAt),
  ],
);

/**
 * Every time the server opened a secret: which credential, whose, what for, and when; for a chat's turn or terminal
 * (S5.1b) also in which company, for which agent and chat, and who asked. The rows outlive the credential, the company's
 * rows and the people (plain ids, no foreign keys), like the audit rows, so a removed subscription's uses stay on record.
 */
export const credentialUses = pgTable(
  'credential_uses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    credentialId: uuid('credential_id').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** What opened it: `usage_check`, `chat_turn`, `chat_terminal`, `tool_check`. */
    purpose: text('purpose').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** The company a chat's use was for; null for the owner's own (a usage check). */
    companyId: uuid('company_id'),
    agentId: uuid('agent_id'),
    chatId: uuid('chat_id'),
    /** Who started the turn or opened the terminal. */
    principalId: uuid('principal_id'),
  },
  (t) => [
    check('credential_uses_purpose_check', lengthWithin(t.purpose, CREDENTIAL_PURPOSE)),
    check(
      'credential_uses_company_check',
      sql`${t.companyId} is not null or (${t.agentId} is null and ${t.chatId} is null and ${t.principalId} is null)`,
    ),
    index('credential_uses_credential_idx').on(t.credentialId, t.at),
  ],
);

/** A credential an access profile holds: one of its owner's, let go when that credential is removed. */
const held = (name: string) => uuid(name).references(() => credentials.id, { onDelete: 'set null' });

/** A tool part's CHECKs: a sign-in only with its rights (the part is there when its rights are), rights an object. */
const toolPartChecks = (tool: ToolProvider, credential: AnyPgColumn, rights: AnyPgColumn) => [
  check(`access_profiles_${tool}_check`, sql`${credential} is null or ${rights} is not null`),
  check(`access_profiles_${tool}_rights_check`, sql`jsonb_typeof(${rights}) = 'object'`),
];

/**
 * Access profiles (S3.4, one provider each since 2026-11-10, docs/subscriptions.md): a person's named choice of one of
 * their own subscriptions, which they give to agents (`agents.profile_id`) and choose as their default for the agents
 * they hire in a company (`memberships.default_claude_profile_id`, `default_openai_profile_id`). A personal table like
 * `credentials`, reached through `owned(db, userId)`. A profile never moves a credential into a company: it is a
 * reference the server resolves at run time.
 *
 * A profile's `provider` is fixed when it is made: a Claude profile holds a Claude subscription (for `claude_code`
 * agents), an OpenAI profile an OpenAI subscription (for `codex` agents), and either an optional gateway, any of its
 * owner's (gateways are universal since 2026-11-10: one address serves Claude Code and Codex, each at its own path;
 * migration `0016_gateway_provider` dropped the CHECK that kept gateways on Claude profiles). Its credentials are its
 * owner's, of kinds that fit (`PROVIDER_KINDS`, `GATEWAY_KINDS`, `TOOL_KINDS` of `@mwc/shared/credentials`), never
 * revoked ones: the credentials module checks that, since SQL cannot read another row's owner or kind here. Removing a
 * credential empties its part (the profile cannot run until its owner chooses another subscription); removing a profile
 * takes it off its agents, chats and defaults (all `on delete set null`).
 *
 * Since migration `0017_profile_model` a profile also says what its runs run: a `model` (one of the catalogue's of its
 * provider or another id, `@mwc/shared/models`) and an `effort`, each null for the provider's default. Agents have no
 * model or effort of their own any more. SQL keeps only the stored levels and the id's length: which levels a model
 * takes is the credentials module's rule.
 *
 * Since migration `0032_profile_tool_parts` (S7.1b reshaped on 2026-11-13: one profile, not one per tool) a profile also
 * has optional tool parts, GitHub and Atlassian: each one of its owner's sign-ins of that tool
 * (`<tool>_credential_id`) and the rights the agents given the profile have there (`<tool>_rights`, jsonb). A part is
 * there when its rights are; its sign-in may be null (none chosen, or removed). The rights' shape (`GitHubRights`,
 * `AtlassianRights` of `@mwc/shared/credentials`) is the credentials module's rule; SQL keeps that they are an object and
 * that a sign-in comes with them. A later tool (Slack, S7.1e) is two more columns and an entry in `PROFILE_TOOL_COLUMNS`
 * (`src/profile-tools.ts`).
 */
export const accessProfiles = pgTable(
  'access_profiles',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** What its owner calls it ("Work"), unique among theirs. */
    name: text('name').notNull(),
    /** Whose subscription it holds, `claude` or `openai`; fixed when it is made. */
    provider: text('provider').$type<ProfileProvider>().notNull(),
    /**
     * The subscription: `claude_oauth`, `claude_setup_token` or `anthropic_api_key` for Claude; `codex_oauth` or
     * `openai_api_key` for OpenAI. Null while it has none (made empty, or its subscription removed).
     */
    credentialId: held('credential_id'),
    /** The profile's optional gateway (any of its owner's), which its runs send their AI requests through. */
    gatewayCredentialId: held('gateway_credential_id'),
    /** The model its runs use (`claude-opus-5-5`, `gpt-6.1-sol`); null for its provider's default (its harness picks). */
    model: text('model'),
    /** The reasoning effort its runs use, one its model takes; null for its provider's default. */
    effort: text('effort').$type<Effort>(),
    /** Its GitHub part's sign-in (`github_oauth` or `github_token`); null without one. */
    githubCredentialId: held('github_credential_id'),
    /** Its GitHub part's rights (`GitHubRights`); null: it has no GitHub part. */
    githubRights: jsonb('github_rights').$type<Record<string, unknown>>(),
    /** Its Atlassian part's sign-in (`atlassian_api_token`), for Jira and Confluence; null without one. */
    atlassianCredentialId: held('atlassian_credential_id'),
    /** Its Atlassian part's rights (`AtlassianRights`); null: it has no Atlassian part. */
    atlassianRights: jsonb('atlassian_rights').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('access_profiles_owner_user_id_name_unique').on(t.ownerUserId, t.name),
    check('access_profiles_name_check', lengthWithin(t.name, ACCESS_PROFILE_NAME)),
    check('access_profiles_provider_check', oneOf(t.provider, ProfileProvider.options)),
    check('access_profiles_model_check', lengthWithin(t.model, { min: 1, max: MODEL_ID_MAX })),
    check('access_profiles_effort_check', oneOf(t.effort, Effort.options)),
    ...toolPartChecks('github', t.githubCredentialId, t.githubRights),
    ...toolPartChecks('atlassian', t.atlassianCredentialId, t.atlassianRights),
  ],
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type CredentialUse = typeof credentialUses.$inferSelect;
export type NewCredentialUse = typeof credentialUses.$inferInsert;
export type AccessProfile = typeof accessProfiles.$inferSelect;
export type NewAccessProfile = typeof accessProfiles.$inferInsert;

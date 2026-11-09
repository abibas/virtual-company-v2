import { ACCESS_PROFILE_NAME, CREDENTIAL_LABEL, CREDENTIAL_PURPOSE } from '@mwc/shared/credentials';
import { CredentialKind, CredentialStatus } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
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
 * Personal credentials (S3.1, docs/subscriptions.md): a person's subscriptions, API keys and gateways. A personal
 * table, owned by a user and never by a company, so it has no `company_id`; code reaches it only through
 * `owned(db, userId)` of `@mwc/db`, which scopes every statement to its owner.
 *
 * The secret is sealed by the server with AES-256-GCM (`key_version` names the master key, `iv` is 12 random bytes per
 * seal, `auth_tag` 16 bytes) and the additional data `credential|<id>|<owner_user_id>|<kind>`, so a row copied onto
 * another id, owner or kind does not open. Everything else is metadata the API shows: never a secret
 * (`account_meta`: plan, organization, scopes, a gateway's base URL).
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
  },
  (t) => [
    check('credentials_kind_check', oneOf(t.kind, CredentialKind.options)),
    check('credentials_status_check', oneOf(t.status, CredentialStatus.options)),
    check('credentials_label_check', lengthWithin(t.label, CREDENTIAL_LABEL)),
    check('credentials_key_version_check', sql`${t.keyVersion} >= 1`),
    check('credentials_iv_check', sql`octet_length(${t.iv}) = 12`),
    check('credentials_auth_tag_check', sql`octet_length(${t.authTag}) = 16`),
    check('credentials_account_meta_check', sql`jsonb_typeof(${t.accountMeta}) = 'object'`),
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
    /** What opened it: `usage_check`, `chat_turn`, `chat_terminal`. */
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

/** A slot of an access profile: one of its owner's credentials, emptied when that credential is removed. */
const slot = (name: string) => uuid(name).references(() => credentials.id, { onDelete: 'set null' });

/**
 * Access profiles (S3.4, docs/subscriptions.md): a person's named bundles of their own subscriptions, which they give
 * to agents (`agents.profile_id`) and choose as their default for the agents they hire in a company
 * (`memberships.default_profile_id`). A personal table like `credentials`, reached through `owned(db, userId)`. A
 * profile never moves a credential into a company: it is a reference the server resolves at run time.
 *
 * Each slot holds one of the owner's credentials of a kind that fits it (`PROFILE_SLOT_KINDS` of
 * `@mwc/shared/credentials`), never a revoked one: the credentials module checks that, since SQL cannot read another
 * row's owner or kind here. Removing a credential empties its slots; removing a profile takes it off its agents and
 * defaults (both `on delete set null`).
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
    /** The Claude subscription of `claude_code` agents: `claude_oauth`, `claude_setup_token` or `anthropic_api_key`. */
    claudeCredentialId: slot('claude_credential_id'),
    /** The OpenAI one of `codex` agents: `codex_oauth` or `openai_api_key`. */
    openaiCredentialId: slot('openai_credential_id'),
    /** An optional gateway the runs send their AI requests through. */
    gatewayCredentialId: slot('gateway_credential_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('access_profiles_owner_user_id_name_unique').on(t.ownerUserId, t.name),
    check('access_profiles_name_check', lengthWithin(t.name, ACCESS_PROFILE_NAME)),
  ],
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type CredentialUse = typeof credentialUses.$inferSelect;
export type NewCredentialUse = typeof credentialUses.$inferInsert;
export type AccessProfile = typeof accessProfiles.$inferSelect;
export type NewAccessProfile = typeof accessProfiles.$inferInsert;

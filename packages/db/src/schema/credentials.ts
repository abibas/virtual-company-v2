import {
  ACCESS_PROFILE_NAME,
  CREDENTIAL_LABEL,
  CREDENTIAL_PURPOSE,
  type GatewayHeaderPreview,
} from '@mwc/shared/credentials';
import {
  ClaudeMode,
  CodexMode,
  CredentialKind,
  CredentialStatus,
  Effort,
  type ProfileProvider,
  ToolCheckError,
  type ToolProvider,
} from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { MODEL_ID_MAX } from '@mwc/shared/models';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
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
    /**
     * A gateway's headers as its page shows them, in order (2026-11-13): each name and a preview of its value made from
     * the value when it was sealed (`agk-NTE5••••MHx8`), never the value. Null for the other kinds, and for a gateway
     * sealed before the previews until the server makes them on its first list.
     */
    headerPreviews: jsonb('header_previews').$type<GatewayHeaderPreview[]>(),
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
    check(
      'credentials_header_previews_check',
      sql`${t.headerPreviews} is null or (${t.kind} = 'gateway' and jsonb_typeof(${t.headerPreviews}) = 'array')`,
    ),
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
    /** What opened it: `usage_check`, `chat_turn`, `chat_terminal`, `tool_check`, `preview` (a gateway's header previews). */
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

/** Each AI part's modes, as its mode's CHECK takes them. */
const PART_MODES = { claude: ClaudeMode.options, openai: CodexMode.options } as const;

/**
 * An AI part's CHECKs: its fields only while the part is there, a model of 1 to 100 characters, a known effort, one of
 * its harness's modes.
 */
const aiPartChecks = (part: ProfileProvider, present: AnyPgColumn, fields: readonly AnyPgColumn[]) => {
  const [, , model, effort, mode] = fields as [
    AnyPgColumn,
    AnyPgColumn,
    AnyPgColumn,
    AnyPgColumn,
    AnyPgColumn,
  ];
  const empty = sql.join(
    fields.map((field) => sql`${field} is null`),
    sql` and `,
  );
  return [
    check(`access_profiles_${part}_check`, sql`${present} or (${empty})`),
    check(`access_profiles_${part}_model_check`, lengthWithin(model, { min: 1, max: MODEL_ID_MAX })),
    check(`access_profiles_${part}_effort_check`, oneOf(effort, Effort.options)),
    check(`access_profiles_${part}_mode_check`, oneOf(mode, PART_MODES[part])),
  ];
};

/** A tool part's CHECKs: a sign-in only with its rights (the part is there when its rights are), rights an object. */
const toolPartChecks = (tool: ToolProvider, credential: AnyPgColumn, rights: AnyPgColumn) => [
  check(`access_profiles_${tool}_check`, sql`${credential} is null or ${rights} is not null`),
  check(`access_profiles_${tool}_rights_check`, sql`jsonb_typeof(${rights}) = 'object'`),
];

/**
 * Access profiles (S3.4; generic since 2026-11-13, docs/subscriptions.md "Profiles"): a person's named profile, which
 * they give to agents (`agents.profile_id`, one each) and choose as their default for the agents they hire in a company
 * (`memberships.default_claude_profile_id`, `default_openai_profile_id`). A personal table like `credentials`, reached
 * through `owned(db, userId)`. A profile never moves a credential into a company: it is a reference the server resolves
 * at run time.
 *
 * A profile is a name and optional parts (Ihor, 2026-11-13: "GENERIC profile, which has under the hood, assigning
 * Claude/GH/Jira etc."), each in its own columns:
 * - **Claude** and **OpenAI** (`<part>_part` says it is there): a subscription of that provider, an optional gateway (any
 *   of the owner's: one address serves Claude Code and Codex), the model and effort its turns run, each null for the
 *   provider's default (`@mwc/shared/models`), and the permission mode they run in (since 2026-11-13, `@mwc/shared/modes`;
 *   null for the default, Manual or Ask). A profile has one of them at most (Ihor, 2026-11-13: "EITHER 1 harness
 *   EITHER 2nd one... NOT BOTH"), and an agent's harness follows it: Claude Code on a Claude part, Codex on an OpenAI
 *   part. A profile with neither (only tool parts) is given to no agent.
 * - **GitHub** and **Atlassian** (there when `<tool>_rights` is): one sign-in of that tool and the rights the agents
 *   given the profile have there (`GitHubRights`, `AtlassianRights` of `@mwc/shared/credentials`).
 *
 * Its credentials are its owner's, of kinds that fit each part (`PROVIDER_KINDS`, `GATEWAY_KINDS`, `TOOL_KINDS`), never
 * revoked ones: the credentials module checks that, since SQL cannot read another row's owner or kind here. SQL keeps
 * one AI part at most, a part's fields set only while the part is there, a model's length, the stored efforts, and a
 * tool part's rights an object. Removing a credential empties its place in the part; removing a profile takes it off its
 * agents, chats and defaults (all `on delete set null`). `PROFILE_PART_COLUMNS` (`src/profile-parts.ts`) maps each part
 * to its columns; Slack (S7.1e) is a tool part's two more columns and an entry there.
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
    /** It has a Claude part. */
    claudePart: boolean('claude_part').notNull().default(false),
    /** The Claude part's subscription (`claude_oauth`, `claude_setup_token`, `anthropic_api_key`); null for none. */
    claudeCredentialId: held('claude_credential_id'),
    /** The Claude part's optional gateway, which its turns send their AI requests through. */
    claudeGatewayCredentialId: held('claude_gateway_credential_id'),
    /** The model its Claude turns run (`claude-opus-5-5`); null for Claude Code's default. */
    claudeModel: text('claude_model'),
    /** The effort its Claude turns run at, one the model takes; null for the default. */
    claudeEffort: text('claude_effort').$type<Effort>(),
    /** The permission mode its Claude turns run in (`--permission-mode`); null for the default, Manual. */
    claudeMode: text('claude_mode').$type<ClaudeMode>(),
    /** It has an OpenAI part. */
    openaiPart: boolean('openai_part').notNull().default(false),
    /** The OpenAI part's subscription (`codex_oauth`, `openai_api_key`); null for none. */
    openaiCredentialId: held('openai_credential_id'),
    /** The OpenAI part's optional gateway. */
    openaiGatewayCredentialId: held('openai_gateway_credential_id'),
    /** The model its Codex turns run (`gpt-6.1-sol`); null for Codex's default. */
    openaiModel: text('openai_model'),
    /** The effort its Codex turns run at; null for the default. */
    openaiEffort: text('openai_effort').$type<Effort>(),
    /** The mode its Codex turns run in (Ask, Auto, Full trust); null for the default, Ask. */
    openaiMode: text('openai_mode').$type<CodexMode>(),
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
    check('access_profiles_one_ai_part_check', sql`not (${t.claudePart} and ${t.openaiPart})`),
    ...aiPartChecks('claude', t.claudePart, [
      t.claudeCredentialId,
      t.claudeGatewayCredentialId,
      t.claudeModel,
      t.claudeEffort,
      t.claudeMode,
    ]),
    ...aiPartChecks('openai', t.openaiPart, [
      t.openaiCredentialId,
      t.openaiGatewayCredentialId,
      t.openaiModel,
      t.openaiEffort,
      t.openaiMode,
    ]),
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

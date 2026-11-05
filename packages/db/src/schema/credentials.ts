import { CREDENTIAL_LABEL, CREDENTIAL_PURPOSE } from '@mwc/shared/credentials';
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
 * Every time the server opened a secret: which credential, whose, what for, and when. The rows outlive the credential
 * (no foreign key on `credential_id`), like its audit rows, so a removed subscription's uses stay on record.
 */
export const credentialUses = pgTable(
  'credential_uses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    credentialId: uuid('credential_id').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** What opened it: `usage_check`, later `run`. */
    purpose: text('purpose').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('credential_uses_purpose_check', lengthWithin(t.purpose, CREDENTIAL_PURPOSE)),
    index('credential_uses_credential_idx').on(t.credentialId, t.at),
  ],
);

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type CredentialUse = typeof credentialUses.$inferSelect;
export type NewCredentialUse = typeof credentialUses.$inferInsert;

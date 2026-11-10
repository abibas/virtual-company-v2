# Database schema

> Generated from `packages/db/src/schema/` by `pnpm --filter @mwc/db diagram`. Do not edit by
> hand: `pnpm mwc check` fails when this file and the schema disagree.

Tables: 29. Migrations: 18, the last is `0017_profile_model`.

```mermaid
erDiagram
  access_profiles {
    uuid id PK "not null, default newId() (app-side)"
    uuid owner_user_id FK "not null"
    text name "not null"
    text provider "not null, claude|openai"
    uuid credential_id FK "nullable"
    uuid gateway_credential_id FK "nullable"
    text model "nullable"
    text effort "nullable, low|medium|high|xhigh|max|ultra"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  agent_placements {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid agent_id FK "not null"
    uuid machine_id FK "not null"
    text mode "not null, host|container"
    text home "not null"
    text config_dir "nullable"
    text worktree_root "nullable"
    text permission_policy "not null, default 'ask', ask|bypass"
    boolean is_default "not null, default true"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  agents {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid principal_id FK "not null"
    text name "not null"
    text slug "not null"
    text role_title "not null"
    text status "not null, default 'active', active|paused|archived"
    text harness "not null, default 'claude_code', claude_code|codex"
    text instructions "not null, default ''"
    integer instructions_rev "not null, default 1"
    integer max_concurrent_runs "not null, default 1"
    smallint face "not null, default 0"
    jsonb settings "not null, default '{}'"
    uuid profile_id FK "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  api_keys {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid principal_id FK "not null"
    text kind "not null, personal|runner|scim"
    text name "not null"
    uuid machine_id FK "nullable"
    text prefix "not null"
    text secret_hash UK "not null"
    text[] scopes "not null, default '{}'::text[]"
    timestamptz expires_at "nullable"
    timestamptz revoked_at "nullable"
    timestamptz last_used_at "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  audit_log {
    bigserial id PK "not null, default auto-increment"
    uuid company_id FK "nullable"
    text actor_kind "not null, user|agent|system|identity"
    uuid actor_principal_id FK "nullable"
    text entity_type "not null"
    text entity_id "not null"
    text action "not null"
    text field "nullable"
    jsonb old_value "nullable"
    jsonb new_value "nullable"
    text request_id "nullable"
    timestamptz created_at "not null, default now()"
  }
  chat_events {
    uuid company_id PK, FK "not null"
    uuid turn_id PK, FK "not null"
    integer seq PK "not null"
    jsonb event "not null"
    timestamptz at "not null, default now()"
  }
  chat_turns {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid chat_id FK "not null"
    integer seq "not null"
    text kind "not null, default 'message', message|compact|clear"
    text prompt "not null"
    text status "not null, default 'queued', queued|running|done|failed|stopped"
    text delivery "nullable, now|after|interrupt"
    uuid profile_id "nullable"
    uuid credential_id "nullable"
    timestamptz started_at "nullable"
    timestamptz ended_at "nullable"
    text result_text "nullable"
    text error "nullable"
    jsonb usage "nullable"
    uuid created_by FK "not null"
    timestamptz created_at "not null, default now()"
  }
  chats {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid agent_id FK "not null"
    text harness "not null, claude_code|codex"
    uuid machine_id FK "not null"
    uuid profile_id FK "nullable"
    uuid profile_set_by FK "nullable"
    text session_id "nullable"
    text title "nullable"
    uuid created_by FK "not null"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
    timestamptz archived_at "nullable"
  }
  companies {
    uuid id PK "not null, default newId() (app-side)"
    text slug UK "not null"
    text name "not null"
    text status "not null, default 'provisioning', provisioning|active|suspended|deleted"
    text identity_provider "not null, default 'clerk'"
    text identity_org_id UK "nullable"
    timestamptz reconciled_at "nullable"
    jsonb settings "not null, default '{}'"
    uuid created_by_user_id FK "nullable"
    timestamptz deleted_at "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  company_logos {
    uuid company_id PK, FK "not null"
    text content_type "not null, image/png|image/jpeg|image/webp"
    bytea bytes "not null"
    integer size "not null"
    text sha256 "not null"
    uuid updated_by_principal_id FK "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  credential_uses {
    bigserial id PK "not null, default auto-increment"
    uuid credential_id "not null"
    uuid owner_user_id FK "not null"
    text purpose "not null"
    timestamptz at "not null, default now()"
    uuid company_id "nullable"
    uuid agent_id "nullable"
    uuid chat_id "nullable"
    uuid principal_id "nullable"
  }
  credentials {
    uuid id PK "not null, default newId() (app-side)"
    uuid owner_user_id FK "not null"
    text kind "not null, claude_oauth|claude_setup_token|codex_oauth|anthropic_api_key|openai_api_key|gateway"
    text label "not null"
    text account_email "nullable"
    jsonb account_meta "not null, default '{}'"
    text status "not null, default 'active', active|needs_sign_in|revoked"
    integer key_version "not null"
    bytea iv "not null"
    bytea auth_tag "not null"
    bytea ciphertext "not null"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
    timestamptz last_used_at "nullable"
  }
  enrollment_tokens {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    text secret_hash UK "not null"
    timestamptz expires_at "not null"
    timestamptz used_at "nullable"
    uuid created_by FK "not null"
    uuid machine_id FK "nullable"
    timestamptz created_at "not null, default now()"
  }
  identity_events {
    uuid id PK "not null, default newId() (app-side)"
    text provider "not null"
    text external_event_id "not null"
    text type "not null, user.upserted|user.deleted|org.upserted|org.deleted|membership.upserted|membership.deleted|invitation.accepted|invitation.revoked|ignored"
    timestamptz occurred_at "not null"
    jsonb payload "not null"
    text status "not null, default 'pending', pending|processed|failed"
    integer attempts "not null, default 0"
    text last_error "nullable"
    timestamptz next_attempt_at "nullable"
    timestamptz processed_at "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  identity_marks {
    text key PK "not null"
    bigint provider_updated_at_ms "nullable"
    boolean deleted "not null, default false"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  identity_outbox {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    text op "not null, create_org|invite|revoke_invite|update_role|remove_member|delete_org"
    jsonb payload "not null, default '{}'"
    text idempotency_key UK "not null"
    text status "not null, default 'pending', pending|done|failed"
    integer attempts "not null, default 0"
    timestamptz next_attempt_at "not null, default now()"
    text last_error "nullable"
    timestamptz completed_at "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  identity_parked_events {
    bigserial id PK "not null, default auto-increment"
    text key "not null"
    text external_event_id "not null"
    jsonb event "not null"
    timestamptz created_at "not null, default now()"
  }
  invitations {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    text email_normalized "not null"
    text role "not null, owner|admin|member|viewer"
    text status "not null, default 'pending', pending|accepted|revoked|expired|failed"
    text external_invitation_id UK "nullable"
    timestamptz expires_at "not null"
    uuid invited_by_principal_id FK "nullable"
    uuid accepted_by_user_id FK "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  machine_logos {
    uuid company_id PK, FK "not null"
    uuid machine_id PK, FK "not null"
    text content_type "not null, image/png|image/jpeg|image/webp"
    bytea bytes "not null"
    integer size "not null"
    text sha256 "not null"
    uuid updated_by_principal_id FK "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  machine_power {
    uuid company_id PK, FK "not null"
    uuid machine_id PK, FK "not null"
    jsonb policy "not null, default '{}'"
    jsonb state "not null, default '{}'"
    uuid updated_by FK "nullable"
    timestamptz updated_at "not null, default now()"
  }
  machine_power_events {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid machine_id FK "not null"
    text action "not null, started|stopped|held|released|kept|policy|timezone|failed"
    text reason "not null"
    text actor "not null"
    timestamptz at "not null, default now()"
  }
  machine_samples {
    uuid company_id PK, FK "not null"
    uuid machine_id PK, FK "not null"
    timestamptz at PK "not null"
    double_precision load1 "not null"
    double_precision load5 "not null"
    double_precision load15 "not null"
    integer cpus "not null"
    double_precision cpu_pct "not null"
    double_precision mem_pct "not null"
    bigint disk_used "not null"
    bigint disk_total "not null"
    bigint uptime_s "not null"
    integer live_runs "not null"
  }
  machines {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    text name "not null"
    text kind "not null, laptop|vm|container"
    text provider "not null, default 'none', none|airia_devbox"
    jsonb provider_ref "nullable"
    uuid controller_machine_id FK "nullable"
    text os "not null"
    text arch "not null"
    text hostname "not null"
    text unix_user "not null"
    text runner_version "not null"
    text claude_version "nullable"
    integer slots "not null, default 1"
    text status "not null, default 'offline', online|offline|draining"
    timestamptz last_seen_at "nullable"
    numeric(10_4) hourly_cost "nullable"
    timestamptz hold_until "nullable"
    text hold_source "nullable, server|live_runs"
    timestamptz removed_at "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  memberships {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid principal_id FK "not null"
    uuid user_id FK "not null"
    text role "not null, owner|admin|member|viewer"
    text granted_role "not null, owner|admin|member|viewer"
    text status "not null, default 'active', invited|active|suspended|removed"
    text external_membership_id "nullable"
    text provider_role "nullable"
    uuid invitation_id FK "nullable"
    uuid default_claude_profile_id FK "nullable"
    uuid default_openai_profile_id FK "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  org_positions {
    uuid company_id PK, FK "not null"
    uuid principal_id PK, FK "not null"
    uuid reports_to_principal_id FK "nullable"
    text title "nullable"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  principals {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    text kind "not null, person|agent"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  runner_sessions {
    uuid id PK "not null, default newId() (app-side)"
    uuid company_id FK "not null"
    uuid machine_id FK "not null"
    timestamptz connected_at "not null, default now()"
    timestamptz disconnected_at "nullable"
    text version "not null"
    text remote_ip "nullable"
  }
  user_identities {
    uuid id PK "not null, default newId() (app-side)"
    uuid user_id FK "not null"
    text provider "not null"
    text issuer "not null"
    text subject "not null"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  users {
    uuid id PK "not null, default newId() (app-side)"
    text primary_email "not null"
    text display_name "nullable"
    text image_url "nullable"
    text status "not null, default 'active', active|deactivated"
    timestamptz created_at "not null, default now()"
    timestamptz updated_at "not null, default now()"
  }
  access_profiles }o--|| users : "owner_user_id"
  access_profiles }o--o| credentials : "credential_id"
  access_profiles }o--o| credentials : "gateway_credential_id"
  agent_placements }o--|| companies : "company_id"
  agent_placements |o--|| agents : "company_id, agent_id"
  agent_placements }o--|| machines : "company_id, machine_id"
  agents }o--|| companies : "company_id"
  agents }o--o| access_profiles : "profile_id"
  agents |o--|| principals : "company_id, principal_id"
  api_keys }o--|| companies : "company_id"
  api_keys }o--|| principals : "company_id, principal_id"
  api_keys }o--o| machines : "company_id, machine_id"
  audit_log }o--o| companies : "company_id"
  audit_log }o--o| principals : "company_id, actor_principal_id"
  chat_events }o--|| companies : "company_id"
  chat_events }o--|| chat_turns : "company_id, turn_id"
  chat_turns }o--|| companies : "company_id"
  chat_turns |o--|| chats : "company_id, chat_id"
  chat_turns }o--|| principals : "company_id, created_by"
  chats }o--|| companies : "company_id"
  chats }o--o| access_profiles : "profile_id"
  chats }o--o| users : "profile_set_by"
  chats }o--|| agents : "company_id, agent_id"
  chats }o--|| machines : "company_id, machine_id"
  chats }o--|| principals : "company_id, created_by"
  companies }o--o| users : "created_by_user_id"
  company_logos |o--|| companies : "company_id"
  company_logos }o--o| principals : "company_id, updated_by_principal_id"
  credential_uses }o--|| users : "owner_user_id"
  credentials }o--|| users : "owner_user_id"
  enrollment_tokens }o--|| companies : "company_id"
  enrollment_tokens }o--|| principals : "company_id, created_by"
  enrollment_tokens }o--o| machines : "company_id, machine_id"
  identity_outbox }o--|| companies : "company_id"
  invitations }o--|| companies : "company_id"
  invitations }o--o| users : "accepted_by_user_id"
  invitations }o--o| principals : "company_id, invited_by_principal_id"
  machine_logos }o--|| companies : "company_id"
  machine_logos |o--|| machines : "company_id, machine_id"
  machine_logos }o--o| principals : "company_id, updated_by_principal_id"
  machine_power }o--|| companies : "company_id"
  machine_power |o--|| machines : "company_id, machine_id"
  machine_power }o--o| principals : "company_id, updated_by"
  machine_power_events }o--|| companies : "company_id"
  machine_power_events }o--|| machines : "company_id, machine_id"
  machine_samples }o--|| companies : "company_id"
  machine_samples }o--|| machines : "company_id, machine_id"
  machines }o--|| companies : "company_id"
  machines }o--o| machines : "company_id, controller_machine_id"
  memberships }o--|| companies : "company_id"
  memberships }o--|| users : "user_id"
  memberships }o--o| access_profiles : "default_claude_profile_id"
  memberships }o--o| access_profiles : "default_openai_profile_id"
  memberships |o--|| principals : "company_id, principal_id"
  memberships }o--o| invitations : "company_id, invitation_id"
  org_positions }o--|| companies : "company_id"
  org_positions |o--|| principals : "company_id, principal_id"
  org_positions }o--o| principals : "company_id, reports_to_principal_id"
  principals }o--|| companies : "company_id"
  runner_sessions }o--|| companies : "company_id"
  runner_sessions }o--|| machines : "company_id, machine_id"
  user_identities }o--|| users : "user_id"
```

Legend: `PK` primary key, `FK` foreign key, `UK` unique on its own; each attribute says whether it
may be null, its default and, for an enum-like CHECK, the allowed values. A relationship is drawn
from the table holding the foreign key and labelled with its columns: `}o--||` many-to-one,
`}o--o|` many-to-one where the foreign key may be null, `|o--` one-to-one (the columns are unique).

## Tables

### `access_profiles`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `owner_user_id` | `uuid` | no |  | FK |  |
| `name` | `text` | no |  |  |  |
| `provider` | `text` | no |  |  | `claude`, `openai` |
| `credential_id` | `uuid` | yes |  | FK |  |
| `gateway_credential_id` | `uuid` | yes |  | FK |  |
| `model` | `text` | yes |  |  |  |
| `effort` | `text` | yes |  |  | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `owner_user_id` → `users` (`id`), on delete no action (`access_profiles_owner_user_id_users_id_fk`)
  - `credential_id` → `credentials` (`id`), on delete set null (`access_profiles_credential_id_credentials_id_fk`)
  - `gateway_credential_id` → `credentials` (`id`), on delete set null (`access_profiles_gateway_credential_id_credentials_id_fk`)
- **Unique:**
  - `access_profiles_owner_user_id_name_unique` (`owner_user_id`, `name`)
- **Checks:**
  - `access_profiles_name_check`: `char_length("name") between 1 and 80`
  - `access_profiles_provider_check`: `provider` is one of `claude`, `openai`
  - `access_profiles_model_check`: `char_length("model") between 1 and 100`
  - `access_profiles_effort_check`: `effort` is one of `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
- **Indexes:** none

### `agent_placements`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `agent_id` | `uuid` | no |  | FK |  |
| `machine_id` | `uuid` | no |  | FK |  |
| `mode` | `text` | no |  |  | `host`, `container` |
| `home` | `text` | no |  |  |  |
| `config_dir` | `text` | yes |  |  |  |
| `worktree_root` | `text` | yes |  |  |  |
| `permission_policy` | `text` | no | `'ask'` |  | `ask`, `bypass` |
| `is_default` | `boolean` | no | `true` |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`agent_placements_company_id_companies_id_fk`)
  - (`company_id`, `agent_id`) → `agents` (`company_id`, `id`), on delete no action (`agent_placements_agent_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`agent_placements_machine_fk`)
- **Unique:**
  - `agent_placements_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `agent_placements_mode_check`: `mode` is one of `host`, `container`
  - `agent_placements_permission_policy_check`: `permission_policy` is one of `ask`, `bypass`
  - `agent_placements_home_check`: `char_length("home") between 1 and 500 and left("home", 1) = '/'`
  - `agent_placements_config_dir_check`: `char_length("config_dir") between 1 and 500 and left("config_dir", 1) = '/'`
  - `agent_placements_worktree_root_check`: `char_length("worktree_root") between 1 and 500 and left("worktree_root", 1) = '/'`
- **Indexes:**
  - `agent_placements_one_default_idx` on (`company_id`, `agent_id`), unique, where `"is_default"`
  - `agent_placements_machine_idx` on (`company_id`, `machine_id`)

### `agents`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `principal_id` | `uuid` | no |  | FK |  |
| `name` | `text` | no |  |  |  |
| `slug` | `text` | no |  |  |  |
| `role_title` | `text` | no |  |  |  |
| `status` | `text` | no | `'active'` |  | `active`, `paused`, `archived` |
| `harness` | `text` | no | `'claude_code'` |  | `claude_code`, `codex` |
| `instructions` | `text` | no | `''` |  |  |
| `instructions_rev` | `integer` | no | `1` |  |  |
| `max_concurrent_runs` | `integer` | no | `1` |  |  |
| `face` | `smallint` | no | `0` |  |  |
| `settings` | `jsonb` | no | `'{}'` |  |  |
| `profile_id` | `uuid` | yes |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`agents_company_id_companies_id_fk`)
  - `profile_id` → `access_profiles` (`id`), on delete set null (`agents_profile_id_access_profiles_id_fk`)
  - (`company_id`, `principal_id`) → `principals` (`company_id`, `id`), on delete no action (`agents_principal_fk`)
- **Unique:**
  - `agents_company_id_id_unique` (`company_id`, `id`)
  - `agents_company_id_principal_id_unique` (`company_id`, `principal_id`)
  - `agents_company_id_slug_unique` (`company_id`, `slug`)
- **Checks:**
  - `agents_name_check`: `char_length("name") between 1 and 80`
  - `agents_slug_check`: `"slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`
  - `agents_role_title_check`: `char_length("role_title") between 1 and 80`
  - `agents_status_check`: `status` is one of `active`, `paused`, `archived`
  - `agents_harness_check`: `harness` is one of `claude_code`, `codex`
  - `agents_instructions_rev_check`: `"instructions_rev" >= 1`
  - `agents_max_concurrent_runs_check`: `"max_concurrent_runs" between 1 and 8`
  - `agents_face_check`: `"face" between 0 and 41`
- **Indexes:**
  - `agents_profile_idx` on (`profile_id`)

### `api_keys`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `principal_id` | `uuid` | no |  | FK |  |
| `kind` | `text` | no |  |  | `personal`, `runner`, `scim` |
| `name` | `text` | no |  |  |  |
| `machine_id` | `uuid` | yes |  | FK |  |
| `prefix` | `text` | no |  |  |  |
| `secret_hash` | `text` | no |  | UK |  |
| `scopes` | `text[]` | no | `'{}'::text[]` |  |  |
| `expires_at` | `timestamp with time zone` | yes |  |  |  |
| `revoked_at` | `timestamp with time zone` | yes |  |  |  |
| `last_used_at` | `timestamp with time zone` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`api_keys_company_id_companies_id_fk`)
  - (`company_id`, `principal_id`) → `principals` (`company_id`, `id`), on delete no action (`api_keys_principal_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`api_keys_machine_fk`)
- **Unique:**
  - `api_keys_secret_hash_unique` (`secret_hash`)
  - `api_keys_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `api_keys_kind_check`: `kind` is one of `personal`, `runner`, `scim`
  - `api_keys_secret_hash_check`: `"secret_hash" ~ '^[0-9a-f]{64}$'`
  - `api_keys_runner_machine_check`: `"kind" <> 'runner' or "machine_id" is not null`
- **Indexes:**
  - `api_keys_principal_idx` on (`company_id`, `principal_id`)

### `audit_log`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `bigserial` | no | `auto-increment` | PK |  |
| `company_id` | `uuid` | yes |  | FK |  |
| `actor_kind` | `text` | no |  |  | `user`, `agent`, `system`, `identity` |
| `actor_principal_id` | `uuid` | yes |  | FK |  |
| `entity_type` | `text` | no |  |  |  |
| `entity_id` | `text` | no |  |  |  |
| `action` | `text` | no |  |  |  |
| `field` | `text` | yes |  |  |  |
| `old_value` | `jsonb` | yes |  |  |  |
| `new_value` | `jsonb` | yes |  |  |  |
| `request_id` | `text` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`audit_log_company_id_companies_id_fk`)
  - (`company_id`, `actor_principal_id`) → `principals` (`company_id`, `id`), on delete no action (`audit_log_actor_principal_fk`)
- **Unique:** none
- **Checks:**
  - `audit_log_actor_kind_check`: `actor_kind` is one of `user`, `agent`, `system`, `identity`
- **Indexes:**
  - `audit_log_entity_idx` on (`company_id`, `entity_type`, `entity_id`, `id`)

### `chat_events`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `company_id` | `uuid` | no |  | PK, FK |  |
| `turn_id` | `uuid` | no |  | PK, FK |  |
| `seq` | `integer` | no |  | PK |  |
| `event` | `jsonb` | no |  |  |  |
| `at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `company_id`, `turn_id`, `seq`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`chat_events_company_id_companies_id_fk`)
  - (`company_id`, `turn_id`) → `chat_turns` (`company_id`, `id`), on delete no action (`chat_events_turn_fk`)
- **Unique:** none
- **Checks:**
  - `chat_events_seq_check`: `"seq" >= 1`
  - `chat_events_event_check`: `jsonb_typeof("event") = 'object'`
- **Indexes:** none

### `chat_turns`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `chat_id` | `uuid` | no |  | FK |  |
| `seq` | `integer` | no |  |  |  |
| `kind` | `text` | no | `'message'` |  | `message`, `compact`, `clear` |
| `prompt` | `text` | no |  |  |  |
| `status` | `text` | no | `'queued'` |  | `queued`, `running`, `done`, `failed`, `stopped` |
| `delivery` | `text` | yes |  |  | `now`, `after`, `interrupt` |
| `profile_id` | `uuid` | yes |  |  |  |
| `credential_id` | `uuid` | yes |  |  |  |
| `started_at` | `timestamp with time zone` | yes |  |  |  |
| `ended_at` | `timestamp with time zone` | yes |  |  |  |
| `result_text` | `text` | yes |  |  |  |
| `error` | `text` | yes |  |  |  |
| `usage` | `jsonb` | yes |  |  |  |
| `created_by` | `uuid` | no |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`chat_turns_company_id_companies_id_fk`)
  - (`company_id`, `chat_id`) → `chats` (`company_id`, `id`), on delete no action (`chat_turns_chat_fk`)
  - (`company_id`, `created_by`) → `principals` (`company_id`, `id`), on delete no action (`chat_turns_created_by_fk`)
- **Unique:**
  - `chat_turns_company_id_id_unique` (`company_id`, `id`)
  - `chat_turns_chat_seq_unique` (`company_id`, `chat_id`, `seq`)
- **Checks:**
  - `chat_turns_status_check`: `status` is one of `queued`, `running`, `done`, `failed`, `stopped`
  - `chat_turns_kind_check`: `kind` is one of `message`, `compact`, `clear`
  - `chat_turns_delivery_check`: `delivery` is one of `now`, `after`, `interrupt`
  - `chat_turns_clear_check`: `"kind" <> 'clear' or ("status" = 'done' and "credential_id" is null)`
  - `chat_turns_seq_check`: `"seq" >= 1`
  - `chat_turns_prompt_check`: `char_length("prompt") between 1 and 20000`
  - `chat_turns_usage_check`: `"usage" is null or jsonb_typeof("usage") = 'object'`
- **Indexes:**
  - `chat_turns_one_running_idx` on (`company_id`, `chat_id`), unique, where `"status" = 'running'`
  - `chat_turns_status_idx` on (`status`)

### `chats`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `agent_id` | `uuid` | no |  | FK |  |
| `harness` | `text` | no |  |  | `claude_code`, `codex` |
| `machine_id` | `uuid` | no |  | FK |  |
| `profile_id` | `uuid` | yes |  | FK |  |
| `profile_set_by` | `uuid` | yes |  | FK |  |
| `session_id` | `text` | yes |  |  |  |
| `title` | `text` | yes |  |  |  |
| `created_by` | `uuid` | no |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |
| `archived_at` | `timestamp with time zone` | yes |  |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`chats_company_id_companies_id_fk`)
  - `profile_id` → `access_profiles` (`id`), on delete set null (`chats_profile_id_access_profiles_id_fk`)
  - `profile_set_by` → `users` (`id`), on delete no action (`chats_profile_set_by_users_id_fk`)
  - (`company_id`, `agent_id`) → `agents` (`company_id`, `id`), on delete no action (`chats_agent_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`chats_machine_fk`)
  - (`company_id`, `created_by`) → `principals` (`company_id`, `id`), on delete no action (`chats_created_by_fk`)
- **Unique:**
  - `chats_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `chats_harness_check`: `harness` is one of `claude_code`, `codex`
  - `chats_title_check`: `char_length("title") between 1 and 80`
  - `chats_session_id_check`: `char_length("session_id") between 1 and 200`
  - `chats_profile_set_by_check`: `"profile_id" is null or "profile_set_by" is not null`
- **Indexes:**
  - `chats_agent_idx` on (`company_id`, `agent_id`, `updated_at`)
  - `chats_profile_idx` on (`profile_id`)

### `companies`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `slug` | `text` | no |  | UK |  |
| `name` | `text` | no |  |  |  |
| `status` | `text` | no | `'provisioning'` |  | `provisioning`, `active`, `suspended`, `deleted` |
| `identity_provider` | `text` | no | `'clerk'` |  |  |
| `identity_org_id` | `text` | yes |  | UK |  |
| `reconciled_at` | `timestamp with time zone` | yes |  |  |  |
| `settings` | `jsonb` | no | `'{}'` |  |  |
| `created_by_user_id` | `uuid` | yes |  | FK |  |
| `deleted_at` | `timestamp with time zone` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `created_by_user_id` → `users` (`id`), on delete no action (`companies_created_by_user_id_users_id_fk`)
- **Unique:**
  - `companies_slug_unique` (`slug`)
  - `companies_identity_org_id_unique` (`identity_org_id`)
- **Checks:**
  - `companies_slug_check`: `"slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`
  - `companies_status_check`: `status` is one of `provisioning`, `active`, `suspended`, `deleted`
- **Indexes:** none

### `company_logos`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `company_id` | `uuid` | no |  | PK, FK |  |
| `content_type` | `text` | no |  |  | `image/png`, `image/jpeg`, `image/webp` |
| `bytes` | `bytea` | no |  |  |  |
| `size` | `integer` | no |  |  |  |
| `sha256` | `text` | no |  |  |  |
| `updated_by_principal_id` | `uuid` | yes |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `company_id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete cascade (`company_logos_company_id_companies_id_fk`)
  - (`company_id`, `updated_by_principal_id`) → `principals` (`company_id`, `id`), on delete no action (`company_logos_updated_by_principal_fk`)
- **Unique:** none
- **Checks:**
  - `company_logos_content_type_check`: `content_type` is one of `image/png`, `image/jpeg`, `image/webp`
  - `company_logos_size_check`: `"size" between 1 and 1048576`
  - `company_logos_sha256_check`: `"sha256" ~ '^[0-9a-f]{64}$'`
- **Indexes:** none

### `credential_uses`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `bigserial` | no | `auto-increment` | PK |  |
| `credential_id` | `uuid` | no |  |  |  |
| `owner_user_id` | `uuid` | no |  | FK |  |
| `purpose` | `text` | no |  |  |  |
| `at` | `timestamp with time zone` | no | `now()` |  |  |
| `company_id` | `uuid` | yes |  |  |  |
| `agent_id` | `uuid` | yes |  |  |  |
| `chat_id` | `uuid` | yes |  |  |  |
| `principal_id` | `uuid` | yes |  |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `owner_user_id` → `users` (`id`), on delete no action (`credential_uses_owner_user_id_users_id_fk`)
- **Unique:** none
- **Checks:**
  - `credential_uses_purpose_check`: `char_length("purpose") between 1 and 80`
  - `credential_uses_company_check`: `"company_id" is not null or ("agent_id" is null and "chat_id" is null and "principal_id" is null)`
- **Indexes:**
  - `credential_uses_credential_idx` on (`credential_id`, `at`)

### `credentials`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `owner_user_id` | `uuid` | no |  | FK |  |
| `kind` | `text` | no |  |  | `claude_oauth`, `claude_setup_token`, `codex_oauth`, `anthropic_api_key`, `openai_api_key`, `gateway` |
| `label` | `text` | no |  |  |  |
| `account_email` | `text` | yes |  |  |  |
| `account_meta` | `jsonb` | no | `'{}'` |  |  |
| `status` | `text` | no | `'active'` |  | `active`, `needs_sign_in`, `revoked` |
| `key_version` | `integer` | no |  |  |  |
| `iv` | `bytea` | no |  |  |  |
| `auth_tag` | `bytea` | no |  |  |  |
| `ciphertext` | `bytea` | no |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |
| `last_used_at` | `timestamp with time zone` | yes |  |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `owner_user_id` → `users` (`id`), on delete no action (`credentials_owner_user_id_users_id_fk`)
- **Unique:** none
- **Checks:**
  - `credentials_kind_check`: `kind` is one of `claude_oauth`, `claude_setup_token`, `codex_oauth`, `anthropic_api_key`, `openai_api_key`, `gateway`
  - `credentials_status_check`: `status` is one of `active`, `needs_sign_in`, `revoked`
  - `credentials_label_check`: `char_length("label") between 1 and 80`
  - `credentials_key_version_check`: `"key_version" >= 1`
  - `credentials_iv_check`: `octet_length("iv") = 12`
  - `credentials_auth_tag_check`: `octet_length("auth_tag") = 16`
  - `credentials_account_meta_check`: `jsonb_typeof("account_meta") = 'object'`
- **Indexes:**
  - `credentials_owner_idx` on (`owner_user_id`, `created_at`)

### `enrollment_tokens`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `secret_hash` | `text` | no |  | UK |  |
| `expires_at` | `timestamp with time zone` | no |  |  |  |
| `used_at` | `timestamp with time zone` | yes |  |  |  |
| `created_by` | `uuid` | no |  | FK |  |
| `machine_id` | `uuid` | yes |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`enrollment_tokens_company_id_companies_id_fk`)
  - (`company_id`, `created_by`) → `principals` (`company_id`, `id`), on delete no action (`enrollment_tokens_created_by_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`enrollment_tokens_machine_fk`)
- **Unique:**
  - `enrollment_tokens_secret_hash_unique` (`secret_hash`)
  - `enrollment_tokens_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `enrollment_tokens_secret_hash_check`: `"secret_hash" ~ '^[0-9a-f]{64}$'`
  - `enrollment_tokens_machine_check`: `"machine_id" is null or "used_at" is not null`
- **Indexes:** none

### `identity_events`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `provider` | `text` | no |  |  |  |
| `external_event_id` | `text` | no |  |  |  |
| `type` | `text` | no |  |  | `user.upserted`, `user.deleted`, `org.upserted`, `org.deleted`, `membership.upserted`, `membership.deleted`, `invitation.accepted`, `invitation.revoked`, `ignored` |
| `occurred_at` | `timestamp with time zone` | no |  |  |  |
| `payload` | `jsonb` | no |  |  |  |
| `status` | `text` | no | `'pending'` |  | `pending`, `processed`, `failed` |
| `attempts` | `integer` | no | `0` |  |  |
| `last_error` | `text` | yes |  |  |  |
| `next_attempt_at` | `timestamp with time zone` | yes |  |  |  |
| `processed_at` | `timestamp with time zone` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:** none
- **Unique:**
  - `identity_events_provider_external_event_id_unique` (`provider`, `external_event_id`)
- **Checks:**
  - `identity_events_type_check`: `type` is one of `user.upserted`, `user.deleted`, `org.upserted`, `org.deleted`, `membership.upserted`, `membership.deleted`, `invitation.accepted`, `invitation.revoked`, `ignored`
  - `identity_events_status_check`: `status` is one of `pending`, `processed`, `failed`
  - `identity_events_attempts_check`: `"attempts" >= 0`
- **Indexes:**
  - `identity_events_status_idx` on (`status`, `next_attempt_at`)

### `identity_marks`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `key` | `text` | no |  | PK |  |
| `provider_updated_at_ms` | `bigint` | yes |  |  |  |
| `deleted` | `boolean` | no | `false` |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `key`
- **Foreign keys:** none
- **Unique:** none
- **Checks:** none
- **Indexes:** none

### `identity_outbox`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `op` | `text` | no |  |  | `create_org`, `invite`, `revoke_invite`, `update_role`, `remove_member`, `delete_org` |
| `payload` | `jsonb` | no | `'{}'` |  |  |
| `idempotency_key` | `text` | no |  | UK |  |
| `status` | `text` | no | `'pending'` |  | `pending`, `done`, `failed` |
| `attempts` | `integer` | no | `0` |  |  |
| `next_attempt_at` | `timestamp with time zone` | no | `now()` |  |  |
| `last_error` | `text` | yes |  |  |  |
| `completed_at` | `timestamp with time zone` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`identity_outbox_company_id_companies_id_fk`)
- **Unique:**
  - `identity_outbox_idempotency_key_unique` (`idempotency_key`)
- **Checks:**
  - `identity_outbox_op_check`: `op` is one of `create_org`, `invite`, `revoke_invite`, `update_role`, `remove_member`, `delete_org`
  - `identity_outbox_status_check`: `status` is one of `pending`, `done`, `failed`
  - `identity_outbox_attempts_check`: `"attempts" >= 0`
- **Indexes:**
  - `identity_outbox_due_idx` on (`status`, `next_attempt_at`)

### `identity_parked_events`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `bigserial` | no | `auto-increment` | PK |  |
| `key` | `text` | no |  |  |  |
| `external_event_id` | `text` | no |  |  |  |
| `event` | `jsonb` | no |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:** none
- **Unique:**
  - `identity_parked_events_key_event_unique` (`key`, `external_event_id`)
- **Checks:** none
- **Indexes:** none

### `invitations`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `email_normalized` | `text` | no |  |  |  |
| `role` | `text` | no |  |  | `owner`, `admin`, `member`, `viewer` |
| `status` | `text` | no | `'pending'` |  | `pending`, `accepted`, `revoked`, `expired`, `failed` |
| `external_invitation_id` | `text` | yes |  | UK |  |
| `expires_at` | `timestamp with time zone` | no |  |  |  |
| `invited_by_principal_id` | `uuid` | yes |  | FK |  |
| `accepted_by_user_id` | `uuid` | yes |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`invitations_company_id_companies_id_fk`)
  - `accepted_by_user_id` → `users` (`id`), on delete no action (`invitations_accepted_by_user_id_users_id_fk`)
  - (`company_id`, `invited_by_principal_id`) → `principals` (`company_id`, `id`), on delete no action (`invitations_invited_by_principal_fk`)
- **Unique:**
  - `invitations_external_invitation_id_unique` (`external_invitation_id`)
  - `invitations_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `invitations_email_lower_check`: `"email_normalized" = lower("email_normalized")`
  - `invitations_role_check`: `role` is one of `owner`, `admin`, `member`, `viewer`
  - `invitations_status_check`: `status` is one of `pending`, `accepted`, `revoked`, `expired`, `failed`
- **Indexes:**
  - `invitations_one_pending_per_email` on (`company_id`, `email_normalized`), unique, where `"status" = 'pending'`

### `machine_logos`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `company_id` | `uuid` | no |  | PK, FK |  |
| `machine_id` | `uuid` | no |  | PK, FK |  |
| `content_type` | `text` | no |  |  | `image/png`, `image/jpeg`, `image/webp` |
| `bytes` | `bytea` | no |  |  |  |
| `size` | `integer` | no |  |  |  |
| `sha256` | `text` | no |  |  |  |
| `updated_by_principal_id` | `uuid` | yes |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `company_id`, `machine_id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`machine_logos_company_id_companies_id_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete cascade (`machine_logos_machine_fk`)
  - (`company_id`, `updated_by_principal_id`) → `principals` (`company_id`, `id`), on delete no action (`machine_logos_updated_by_principal_fk`)
- **Unique:** none
- **Checks:**
  - `machine_logos_content_type_check`: `content_type` is one of `image/png`, `image/jpeg`, `image/webp`
  - `machine_logos_size_check`: `"size" between 1 and 1048576`
  - `machine_logos_sha256_check`: `"sha256" ~ '^[0-9a-f]{64}$'`
- **Indexes:** none

### `machine_power`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `company_id` | `uuid` | no |  | PK, FK |  |
| `machine_id` | `uuid` | no |  | PK, FK |  |
| `policy` | `jsonb` | no | `'{}'` |  |  |
| `state` | `jsonb` | no | `'{}'` |  |  |
| `updated_by` | `uuid` | yes |  | FK |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `company_id`, `machine_id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`machine_power_company_id_companies_id_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`machine_power_machine_fk`)
  - (`company_id`, `updated_by`) → `principals` (`company_id`, `id`), on delete no action (`machine_power_updated_by_fk`)
- **Unique:** none
- **Checks:**
  - `machine_power_policy_check`: `jsonb_typeof("policy") = 'object'`
  - `machine_power_state_check`: `jsonb_typeof("state") = 'object'`
- **Indexes:** none

### `machine_power_events`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `machine_id` | `uuid` | no |  | FK |  |
| `action` | `text` | no |  |  | `started`, `stopped`, `held`, `released`, `kept`, `policy`, `timezone`, `failed` |
| `reason` | `text` | no |  |  |  |
| `actor` | `text` | no |  |  |  |
| `at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`machine_power_events_company_id_companies_id_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`machine_power_events_machine_fk`)
- **Unique:**
  - `machine_power_events_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `machine_power_events_action_check`: `action` is one of `started`, `stopped`, `held`, `released`, `kept`, `policy`, `timezone`, `failed`
  - `machine_power_events_reason_check`: `char_length("reason") between 1 and 500`
  - `machine_power_events_actor_check`: `"actor" ~ '^(user:[0-9a-f-]{36}|schedule|auto|system)$'`
- **Indexes:**
  - `machine_power_events_machine_idx` on (`company_id`, `machine_id`, `at`)

### `machine_samples`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `company_id` | `uuid` | no |  | PK, FK |  |
| `machine_id` | `uuid` | no |  | PK, FK |  |
| `at` | `timestamp with time zone` | no |  | PK |  |
| `load1` | `double precision` | no |  |  |  |
| `load5` | `double precision` | no |  |  |  |
| `load15` | `double precision` | no |  |  |  |
| `cpus` | `integer` | no |  |  |  |
| `cpu_pct` | `double precision` | no |  |  |  |
| `mem_pct` | `double precision` | no |  |  |  |
| `disk_used` | `bigint` | no |  |  |  |
| `disk_total` | `bigint` | no |  |  |  |
| `uptime_s` | `bigint` | no |  |  |  |
| `live_runs` | `integer` | no |  |  |  |

- **Primary key:** `company_id`, `machine_id`, `at`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`machine_samples_company_id_companies_id_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`machine_samples_machine_fk`)
- **Unique:** none
- **Checks:**
  - `machine_samples_cpus_check`: `"cpus" >= 1`
- **Indexes:**
  - `machine_samples_at_idx` on (`at`)

### `machines`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `name` | `text` | no |  |  |  |
| `kind` | `text` | no |  |  | `laptop`, `vm`, `container` |
| `provider` | `text` | no | `'none'` |  | `none`, `airia_devbox` |
| `provider_ref` | `jsonb` | yes |  |  |  |
| `controller_machine_id` | `uuid` | yes |  | FK |  |
| `os` | `text` | no |  |  |  |
| `arch` | `text` | no |  |  |  |
| `hostname` | `text` | no |  |  |  |
| `unix_user` | `text` | no |  |  |  |
| `runner_version` | `text` | no |  |  |  |
| `claude_version` | `text` | yes |  |  |  |
| `slots` | `integer` | no | `1` |  |  |
| `status` | `text` | no | `'offline'` |  | `online`, `offline`, `draining` |
| `last_seen_at` | `timestamp with time zone` | yes |  |  |  |
| `hourly_cost` | `numeric(10, 4)` | yes |  |  |  |
| `hold_until` | `timestamp with time zone` | yes |  |  |  |
| `hold_source` | `text` | yes |  |  | `server`, `live_runs` |
| `removed_at` | `timestamp with time zone` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`machines_company_id_companies_id_fk`)
  - (`company_id`, `controller_machine_id`) → `machines` (`company_id`, `id`), on delete no action (`machines_controller_fk`)
- **Unique:**
  - `machines_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `machines_name_check`: `char_length("name") between 1 and 80`
  - `machines_kind_check`: `kind` is one of `laptop`, `vm`, `container`
  - `machines_provider_check`: `provider` is one of `none`, `airia_devbox`
  - `machines_status_check`: `status` is one of `online`, `offline`, `draining`
  - `machines_hold_source_check`: `hold_source` is one of `server`, `live_runs`
  - `machines_provider_ref_check`: `jsonb_typeof("provider_ref") = 'object'`
  - `machines_slots_check`: `"slots" between 0 and 64`
  - `machines_hourly_cost_check`: `"hourly_cost" >= 0`
  - `machines_controller_check`: `"controller_machine_id" <> "id"`
- **Indexes:**
  - `machines_status_idx` on (`status`, `last_seen_at`)

### `memberships`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `principal_id` | `uuid` | no |  | FK |  |
| `user_id` | `uuid` | no |  | FK |  |
| `role` | `text` | no |  |  | `owner`, `admin`, `member`, `viewer` |
| `granted_role` | `text` | no |  |  | `owner`, `admin`, `member`, `viewer` |
| `status` | `text` | no | `'active'` |  | `invited`, `active`, `suspended`, `removed` |
| `external_membership_id` | `text` | yes |  |  |  |
| `provider_role` | `text` | yes |  |  |  |
| `invitation_id` | `uuid` | yes |  | FK |  |
| `default_claude_profile_id` | `uuid` | yes |  | FK |  |
| `default_openai_profile_id` | `uuid` | yes |  | FK |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`memberships_company_id_companies_id_fk`)
  - `user_id` → `users` (`id`), on delete no action (`memberships_user_id_users_id_fk`)
  - `default_claude_profile_id` → `access_profiles` (`id`), on delete set null (`memberships_default_claude_profile_id_access_profiles_id_fk`)
  - `default_openai_profile_id` → `access_profiles` (`id`), on delete set null (`memberships_default_openai_profile_id_access_profiles_id_fk`)
  - (`company_id`, `principal_id`) → `principals` (`company_id`, `id`), on delete no action (`memberships_principal_fk`)
  - (`company_id`, `invitation_id`) → `invitations` (`company_id`, `id`), on delete no action (`memberships_invitation_fk`)
- **Unique:**
  - `memberships_company_id_id_unique` (`company_id`, `id`)
  - `memberships_company_id_user_id_unique` (`company_id`, `user_id`)
  - `memberships_company_id_principal_id_unique` (`company_id`, `principal_id`)
- **Checks:**
  - `memberships_role_check`: `role` is one of `owner`, `admin`, `member`, `viewer`
  - `memberships_granted_role_check`: `granted_role` is one of `owner`, `admin`, `member`, `viewer`
  - `memberships_status_check`: `status` is one of `invited`, `active`, `suspended`, `removed`
- **Indexes:**
  - `memberships_user_id_idx` on (`user_id`)
  - `memberships_default_claude_profile_idx` on (`default_claude_profile_id`)
  - `memberships_default_openai_profile_idx` on (`default_openai_profile_id`)

### `org_positions`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `company_id` | `uuid` | no |  | PK, FK |  |
| `principal_id` | `uuid` | no |  | PK, FK |  |
| `reports_to_principal_id` | `uuid` | yes |  | FK |  |
| `title` | `text` | yes |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `company_id`, `principal_id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`org_positions_company_id_companies_id_fk`)
  - (`company_id`, `principal_id`) → `principals` (`company_id`, `id`), on delete no action (`org_positions_principal_fk`)
  - (`company_id`, `reports_to_principal_id`) → `principals` (`company_id`, `id`), on delete no action (`org_positions_reports_to_fk`)
- **Unique:** none
- **Checks:**
  - `org_positions_not_self_check`: `"principal_id" <> "reports_to_principal_id"`
  - `org_positions_title_check`: `char_length("title") <= 80`
- **Indexes:**
  - `org_positions_reports_to_idx` on (`company_id`, `reports_to_principal_id`)

### `principals`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `kind` | `text` | no |  |  | `person`, `agent` |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`principals_company_id_companies_id_fk`)
- **Unique:**
  - `principals_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `principals_kind_check`: `kind` is one of `person`, `agent`
- **Indexes:** none

### `runner_sessions`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `company_id` | `uuid` | no |  | FK |  |
| `machine_id` | `uuid` | no |  | FK |  |
| `connected_at` | `timestamp with time zone` | no | `now()` |  |  |
| `disconnected_at` | `timestamp with time zone` | yes |  |  |  |
| `version` | `text` | no |  |  |  |
| `remote_ip` | `text` | yes |  |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `company_id` → `companies` (`id`), on delete no action (`runner_sessions_company_id_companies_id_fk`)
  - (`company_id`, `machine_id`) → `machines` (`company_id`, `id`), on delete no action (`runner_sessions_machine_fk`)
- **Unique:**
  - `runner_sessions_company_id_id_unique` (`company_id`, `id`)
- **Checks:**
  - `runner_sessions_span_check`: `"disconnected_at" >= "connected_at"`
- **Indexes:**
  - `runner_sessions_machine_idx` on (`company_id`, `machine_id`, `connected_at`)

### `user_identities`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `user_id` | `uuid` | no |  | FK |  |
| `provider` | `text` | no |  |  |  |
| `issuer` | `text` | no |  |  |  |
| `subject` | `text` | no |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:**
  - `user_id` → `users` (`id`), on delete no action (`user_identities_user_id_users_id_fk`)
- **Unique:**
  - `user_identities_issuer_subject_unique` (`issuer`, `subject`)
- **Checks:** none
- **Indexes:**
  - `user_identities_user_id_idx` on (`user_id`)

### `users`

| Column | Type | Nullable | Default | Key | Allowed values |
| ------ | ---- | -------- | ------- | --- | -------------- |
| `id` | `uuid` | no | `newId() (app-side)` | PK |  |
| `primary_email` | `text` | no |  |  |  |
| `display_name` | `text` | yes |  |  |  |
| `image_url` | `text` | yes |  |  |  |
| `status` | `text` | no | `'active'` |  | `active`, `deactivated` |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

- **Primary key:** `id`
- **Foreign keys:** none
- **Unique:** none
- **Checks:**
  - `users_primary_email_lower_check`: `"primary_email" = lower("primary_email")`
  - `users_status_check`: `status` is one of `active`, `deactivated`
- **Indexes:** none

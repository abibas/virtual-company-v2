# Where agents live, subscriptions and access profiles

Design agreed with Ihor on 2026-11-05. It reorders the roadmap: subscriptions, access profiles and the limits widget
are S3, machines and placements S4, runs S5, the inbox and the SLOP BOX milestone S6.

## Goals

- One place to sign in. Ihor adds his Claude and OpenAI subscriptions, API keys and gateways once, here. No machine,
  container or devbox ever signs in to an AI provider itself.
- Agents get an **access profile**, not a login: a named bundle of the subscriptions a run may use.
- Secrets are readable only by the server, never shown back, and never stored on the machines that run agents.
- The home page shows each subscription's live 5-hour and weekly limits.

## Where agents live: three placements on one model

Every machine runs the `mwc` runner (S4), which dials out to the server. An agent's placement is a machine and a mode:

| Placement           | Machine                                   | Mode                                                         |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Local shared space  | Ihor's Mac (runner as a launchd service)  | `host`: a folder on the Mac, running as Ihor; full trust     |
| Container (Docker)  | any runner with Docker (the Mac, a host)  | `container`: a fresh locked-down container per run: only the work folder mounted, a non-root user, no Docker socket, no home folder |
| Remote machine      | a VM such as the devbox (systemd runner)  | `host` or `container` on that machine                        |

The placement says where the agent's home folder (its CLAUDE.md, skills and memory) lives. The access profile says
which subscription its runs use. The two are independent.

## Subscriptions

A subscription is a personal credential: it belongs to the person who added it (a Clerk-signed-in user), never to a
company. Kinds:

| Kind                  | How it is added                                                                  | Stored                                    | Limits                                    |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `claude_oauth`        | **Sign in with Claude**: the official CLI's full login in the sign-in helper     | the login's token set and its account config | `GET api.anthropic.com/api/oauth/usage` |
| `claude_setup_token`  | paste the output of `claude setup-token` (inference only, one year)              | the token                                 | the `anthropic-ratelimit-unified-*` headers of a one-token request (the usage API refuses these tokens: v1's lesson) |
| `codex_oauth`         | **Sign in with OpenAI**: `codex login --device-auth` in the sign-in helper       | the login's `auth.json`                   | `GET chatgpt.com/backend-api/wham/usage`  |
| `anthropic_api_key`   | paste                                                                            | the key                                   | none (pay as you go)                      |
| `openai_api_key`      | paste                                                                            | the key                                   | none                                      |
| `gateway`             | an address and headers (for example Ihor's gateway on port 8300)                 | the headers                               | none                                      |

"Subscription login" (Ihor, 2026-11-05): adding a subscription obtains **and stores** its login token and config,
so nothing has to be signed in again on a machine.

### The sign-in helper

The official CLIs run their own login in an isolated Linux sandbox that is thrown away afterwards: a throwaway Docker
container in development (macOS keeps Claude logins in the Keychain, so the login cannot run on the Mac itself), and
the server's own Linux container (a private tmpfs folder) in production. It is a login, not an agent run, and gets no
mounts and no credentials. The flow streams the provider's sign-in address to the page; for Claude, Ihor pastes the code
Anthropic shows back into the page; the helper's resulting files are read, encrypted and stored, and the sandbox is
deleted. Only Ihor completes a sign-in; nothing signs in for him.

As built in S3.2:

- **The port.** `LoginHelper` (`apps/server/src/platform/login-helper/port.ts`) starts one login in a sandbox and gives
  its output as it comes, typing into its terminal, reading a file of its home and killing it. `MWC_LOGIN_HELPER`
  chooses it: `docker` (the development default), `local`, or `none` (production and tests by default, until the
  server image carries the CLIs: `POST /api/me/subscriptions/sign-in` answers 503 `sign_in_unavailable`; tests pass a
  fake).
- **`docker`.** The image is built on the first sign-in from `deploy/Dockerfile.login` alone (no build context) and
  tagged `mwc-login:<the first 12 hex digits of the file's SHA-256>`: `node:24.21.0-slim`, the system CA roots (Codex
  checks TLS against them), `@anthropic-ai/claude-code@2.1.308` (published 2026-10-22) and `@openai/codex@0.163.0`
  (2026-10-15), pinned on 2026-11-05 at least 14 days after their release, the non-root `node` user. Each sign-in
  starts a container detached with `--rm`, `--read-only`, a tmpfs `/tmp` and a tmpfs home (`/home/node`, 0700),
  `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 256`, `--memory 1g`, `--cpus 1`,
  `--user 1000:1000`, no volume, no environment variable and no credential from the host; its only process is
  `sleep 720`, so it ends by itself after 12 minutes if the server stops mid-sign-in. The CLI runs in it with
  `docker exec -i` behind util-linux's `script -qfec "stty cols 2000 rows 50; exec <cli>" /dev/null`, the terminal
  the CLIs need (never `docker run -t` from a server without one). The login's files are read with
  `docker exec <name> cat`, and `docker rm --force` ends it.
- **`local`.** For a Linux server whose own container has the CLIs and `script`: a private `mkdtemp` folder is the
  login's whole home, with an environment made from nothing (HOME, CODEX_HOME, PATH, the terminal, the CLIs' update
  and telemetry switches; no CLAUDE_CONFIG_DIR, no key), removed afterwards.
- **Claude.** `claude auth login --claudeai`, the subscription's full OAuth login (with a refresh token; not the
  inference-only `setup-token`). The pinned CLI prints, with no browser to open:

  ```
  Opening browser to sign in…
  If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=…&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload+user%3Aplugins&code_challenge=…&code_challenge_method=S256&state=…
  Paste code here if prompted >
  ```

  The address (an OSC 8 hyperlink and plain text) is passed on only when it is https on `claude.com`, `claude.ai`,
  `platform.claude.com` or `console.anthropic.com` with the path `/oauth/authorize`. The pasted code (`<code>#<state>`,
  one word of URL-safe characters) is typed in with Enter; a clean exit means signed in, and
  `~/.claude/.credentials.json` (required, with an access token) and the `oauthAccount` of `~/.claude.json` are read.
  Stored as `claude_oauth`, secret `{ credentials, account }`, email `oauthAccount.emailAddress`, details
  `organizationName`, `subscriptionType`, `rateLimitTier` and `scopes`, named "Claude · <email>".
- **OpenAI.** `codex login --device-auth -c cli_auth_credentials_store=file`. The pinned CLI prints:

  ```
  Follow these steps to sign in with ChatGPT using device code authorization:

  1. Open this link in your browser and sign in to your account
     https://auth.openai.com/codex/device

  2. Enter this one-time code (expires in 15 minutes)
     XXXX-XXXXX

  Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.
  ```

  and waits; a clean exit means signed in, and `~/.codex/auth.json` (with an access token) is read. Stored as
  `codex_oauth`, secret `{ auth }`, email from the id_token's `email` claim (decoded for display, not verified), the
  ChatGPT plan (`chatgpt_plan_type`) as `planType`, named "OpenAI · <email>".
- **Sessions.** In the server's memory, bound to the person who started one (another person's is a 404 like none), at
  most one active per person (`409 sign_in_active`), 10 minutes each. States: `starting` → `waiting_for_user` (the
  address, with OpenAI's code) → `waiting_for_code` (Claude's prompt is up) → `completing` (the code is in, or Codex
  finished; the files are read and stored) → `done` (with `credentialId`), or `failed` (a plain message), `expired`,
  `cancelled`. The CLI has 90 seconds to show its address and Claude 60 seconds to finish after the code. Every end
  kills the sandbox; a login already being stored finishes `done` even when cancelled or out of time. A server
  restart forgets the sign-ins in progress (their containers end themselves).
- **Routes** (personal, a session only; an API key is 403 `session_required`): `POST /api/me/subscriptions/sign-in`
  `{ provider: 'claude' | 'openai', label? }` → 201 `starting`; `GET /api/me/subscriptions/sign-in/:id` (the web polls
  every 2 seconds); `POST /api/me/subscriptions/sign-in/:id/code` `{ code }` → 200 `completing`, 409
  `sign_in_not_waiting` when no code is awaited (always for OpenAI); `DELETE /api/me/subscriptions/sign-in/:id` →
  200 `cancelled`.
- **Sign in again** (a card's button on a login that `needs_sign_in`) starts with `credentialId`, the caller's own
  `claude_oauth` or `codex_oauth` of that provider (else 404 `credential_not_found`, 422 `sign_in_kind_mismatch` or
  `credential_revoked`): the login replaces its secret in place (`renewCredentialLogin`, audited without the secret),
  sets it `active` with the new account email and details and keeps its id, name and access profiles; the done sign-in
  carries that `credentialId`, with `accountChanged: true` when another account signed in.
- **Logs.** A sign-in logs its id, provider, helper and how it ended, never the CLI's output (the terminal echoes the
  pasted code), the code, an address, a token or a file; the logger also blanks the logins' token keys, `pastedCode`,
  `screen` and `output`.

### How to sign in (Ihor)

1. Docker Desktop runs on the Mac, and the server runs in development (`pnpm dev`; `MWC_LOGIN_HELPER` unset means
   `docker`). The first sign-in builds the image (a minute or two); later ones start in seconds.
2. On the Subscriptions page (`/subscriptions`: your account menu → **Subscriptions**, or **Manage** on the home
   page's Subscription limits), choose **Add a subscription**, then **Sign in with Claude** or **Sign in with
   OpenAI** (the home page's **Add a subscription** opens the same sheet). The API does the same:
   `POST /api/me/subscriptions/sign-in` with your web session.
3. Claude: open the address shown, approve on Anthropic's page, copy the code it shows and paste it back in the app.
   OpenAI: open the device page, sign in to ChatGPT and type in the one-time code shown in the app; the app notices
   when you are done. If OpenAI's page says device code sign-in is off for your account, turn it on in ChatGPT's
   security settings and start again.
4. The page shows the new subscription, named "Claude · <email>" or "OpenAI · <email>" (rename it on the page). Cancel
   or wait 10 minutes to give up; nothing is stored then.

## Access profiles

A personal, named bundle: the Claude subscription for `claude_code` agents, the OpenAI one for `codex` agents, an
optional gateway, later the GitHub and Jira sign-ins of S7. Its owner gives it to agents in companies where they are an
admin or owner (`agents.profile_id`); each person has a default profile per company for the agents they hire. A
profile never moves a credential into a company: it is a reference the server resolves at run time.

Built in S3.4 (migration `0008_access_profiles`):

- **Slots.** `access_profiles` is personal (an owner, no company). Each slot holds one of the owner's own credentials of
  a kind it takes: Claude `claude_oauth`, `claude_setup_token` or `anthropic_api_key`; OpenAI `codex_oauth` or
  `openai_api_key`; gateway `gateway` (`PROFILE_SLOT_KINDS` of `@mwc/shared/credentials`). A revoked credential cannot be
  put in; one revoked while in a slot stays until it is replaced. Removing a credential empties its slots; names are
  unique per owner.
- **Managing them:** `/api/me/access-profiles` (`GET`, `POST`, `PATCH`/`DELETE /:profileId`), the owner's Clerk session
  only, like subscriptions. The list shows each slot as subscription metadata and the agents using the profile in the
  owner's companies.
- **Giving one to an agent:** `profileId` on `POST`/`PATCH /api/companies/:companyId/agents`. Only the profile's owner
  gives it, signed in (an API key: 403 `session_required`), in a company where they are an admin or owner; someone
  else's profile is 403 `profile_not_yours`, none 422 `profile_not_found`. Any admin or owner of the company takes a
  profile off an agent (`null`), with a session or an API key. Agents and the chart show
  `profile: {id, name, ownerUserId, ownerName}`, never its subscriptions.
- **The default:** `PUT /api/companies/:companyId/me/default-profile` sets the caller's own default there (the same
  rule as giving; clearing it is any active member's), shown as `defaultProfileId` on `GET /api/me`. An agent hired
  without `profileId` gets the hirer's default, also when hired with an API key: the owner chose it signed in.
- **Leaving a company** (removed, leaving, removed or deleted at the provider, suspended: every path of the org chart's
  lifecycle) takes the person's profiles off the company's agents in the same transaction, so their personal
  subscriptions stop powering a company they left. A re-activation does not put them back.
- **Removing a profile** takes it off its agents and its owner's defaults through the foreign keys, with the audit rows
  of each in its company, by the owner.
- **Audit:** profile create, update and delete (personal rows), an agent's `profileId`, a membership's
  `defaultProfileId`.

## Security

- **At rest:** AES-256-GCM per secret, with the AAD binding it to its id, owner and kind, and a key version so the
  master key can rotate. The master key is `MWC_MASTER_KEY` in production (a cloud key service later) and a generated
  `.data/master.key` (0600, git-ignored) in development; tests use a key in memory (S3.1). It is never logged or
  printed.
- **Write-only:** the API returns metadata (kind, label, account email, plan, status, last checked), never the secret,
  not even to its owner. Adding, renaming, removing and assigning need the owner's Clerk session; API keys are refused.
- **On machines:** nothing at rest. How a run receives its credential is decided in S5, starting with a short test of a
  relay: the run would get a short-lived run token and the server would swap in the real credential, so SSH into a
  container or a box finds nothing reusable. The fallback hands the credential to the run's environment over the
  runner's connection, never to disk, where root on that machine could read it while the run lives.
- **Audit:** every add, change, removal and assignment, and every server-side use of a secret (a usage check, later a
  run), with who or what used it. The uses are `credential_uses` rows, kept, like the audit rows, after a
  subscription is removed (S3.1).

## The limits widget

"Subscription limits" on the home page, with **Manage** and **Add a subscription**. One card per subscription of the
signed-in person: its name and account email; for subscriptions, the 5-hour and weekly bars with the percentage and
the reset time (per-model weekly windows when the provider gives them); amber from 80%, red when reached; the
provider's refusals in plain words ("The provider rate limited the usage check. Try again later."), keeping the last
good values. Limits are checked when the page opens, at most every 5 minutes per subscription (15 for the one-token
probe, which spends a little of the subscription).

### The limits API (S3.3)

`GET /api/me/subscriptions/limits` is a personal route (a signed-in session only; an API key is 403
`session_required`). It answers `{ limits: [...] }`, one entry per subscription of the caller, oldest first:

```
{ credentialId, kind, label, accountEmail, source: 'usage_api' | 'message_headers' | 'none', checkedAt,
  windows: [{ id: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'weekly',
              label, usedPercent (0–100, two decimals), resetsAt (ISO, or null when the provider gives none), reached }],
  error: { code, message } | null, stale }
```

| Kind                 | Check                                                                                         | Token refresh |
| -------------------- | --------------------------------------------------------------------------------------------- | ------------- |
| `claude_oauth`       | `GET https://api.anthropic.com/api/oauth/usage`, `Authorization: Bearer <access token>`, `anthropic-beta: oauth-2025-04-20`; `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` (utilization in percent, `resets_at`) | Claude Code's own refresh: `POST https://platform.claude.com/v1/oauth/token`, JSON `grant_type=refresh_token`, the refresh token, Claude Code's client id and the login's scopes; `expires_in` becomes `expiresAt` |
| `claude_setup_token` | `POST https://api.anthropic.com/v1/messages`, `max_tokens: 1` of `claude-haiku-5-5`, the same bearer and beta header, `anthropic-version: 2023-06-01`; only the headers are read: `anthropic-ratelimit-unified-<5h\|7d\|7d_opus\|7d_sonnet>-utilization` (a fraction), `-reset` (epoch seconds), `-status` (`rejected` is reached), on a 429 too | none (one year) |
| `codex_oauth`        | `GET https://chatgpt.com/backend-api/wham/usage`, the bearer and `ChatGPT-Account-Id`; `rate_limit.primary_window` and `secondary_window` mapped by `limit_window_seconds` (a day or less is `five_hour`, longer `weekly`) | v1's: `POST https://auth.openai.com/oauth/token`, JSON with Codex's client id and `scope: openid profile email`; `last_refresh` now, `account_id` kept |
| keys and gateways    | none: `source: 'none'`, no secret opened                                                       | — |

- **When:** a login's access token is refreshed when it expires within 5 minutes (Claude's `expiresAt`, the `exp` of
  OpenAI's JWT), and once after a 401. The new token set is sealed again in place of the old one
  (`replaceCredentialSecret`, an audit row `replace_secret` that names the key version and the purpose, never the
  secret). A second 401, a refresh the provider refuses (4xx) or a login without tokens sets the subscription to
  `needs_sign_in` (audited, the system acting); a later good check sets it back to `active`. A refresh that is rate
  limited or down is only a failed check.
- **Cache and floors:** each subscription's last check (its time, its refusal, the last good windows) is kept in the
  server's memory behind the `UsageCache` port. A plain request answers from it and checks only a subscription not
  checked since the server started; `?refresh=1` also checks one whose last check is at least 5 minutes old (15 for
  the probe). One check runs per subscription at a time; concurrent requests share it.
- **Refusals:** `rate_limited` ("The provider rate limited the usage check. Try again later."), `usage_refused`
  (403), `needs_sign_in`, `provider_unavailable` (network, timeout, 5xx), `invalid_response`, `credential_revoked`,
  `check_failed` (a bug, logged by name only). A failed check keeps the last good windows, with `stale: true`.
- **Records and logs:** every check opens the secret through `useCredentialSecret(…, 'usage_check')`, one
  `credential_uses` row each; cached answers and keys open nothing. A log line names the credential, its kind and the
  refusal's code; never a token or a provider's answer. Every provider call goes through an injected `fetch`
  (`AppDeps.providerFetch`), with redirects refused and a 10-second deadline; under `NODE_ENV=test` the default refuses
  every call, so no test reaches a provider.
- **Not verified against the real providers yet:** the probe's model id (v1 used `claude-haiku-4-5`), the Claude token
  URL and body (read from Claude Code 2.1.318's own configuration; v1 let `claude auth status` refresh), and a
  refresh racing another process that holds the same refresh token (one server process today).

## Out of scope for S3

Runs and the relay (S5); GitHub and Jira sign-ins (S7); company-owned subscriptions; sharing a personal subscription
with other people (it stays its owner's, within the provider's terms).

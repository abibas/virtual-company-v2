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

## Access profiles

A personal, named bundle: the Claude subscription for `claude_code` agents, the OpenAI one for `codex` agents, an
optional gateway, later the GitHub and Jira sign-ins of S7. Its owner gives it to agents in companies where they are an
admin or owner (`agents.profile_id`); each person has a default profile per company for the agents they hire. A
profile never moves a credential into a company: it is a reference the server resolves at run time.

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

# Where agents live, subscriptions and profiles

Design agreed with Ihor on 2026-11-05. It reorders the roadmap: subscriptions, access profiles and the limits widget
are S3, machines and placements S4, runs S5, the inbox and the SLOP BOX milestone S6.

## Goals

- One place to sign in. Ihor adds his Claude and OpenAI subscriptions, API keys and gateways once, here. No machine,
  container or devbox ever signs in to an AI provider itself.
- Agents get a **profile**, not a login: a named set of parts (a Claude or OpenAI subscription a run may use, GitHub and
  Atlassian access).
- Secrets are readable only by the server, never shown back, and never stored on the machines that run agents.
- The home page shows each subscription's live 5-hour and weekly limits.

## Where agents live: three placements on one model

Every machine runs the `mwc` runner (S4), which dials out to the server. An agent's placement is a machine and a mode:

| Placement           | Machine                                   | Mode                                                         |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Local shared space  | Ihor's Mac (runner as a launchd service)  | `host`: a folder on the Mac, running as Ihor; full trust     |
| Container (Docker)  | any runner with Docker (the Mac, a host)  | `container`: a fresh locked-down container per run: only the work folder mounted, a non-root user, no Docker socket, no home folder |
| Remote machine      | a VM such as the devbox (systemd runner)  | `host` or `container` on that machine                        |

The placement says where the agent's home folder (its CLAUDE.md, skills and memory) lives. The profile says
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
| `gateway`             | for Claude Code and Codex alike, an address, optional per-CLI paths and headers (for example Ihor's gateway on port 8300) | the headers (the address and paths are account details) | none |

"Subscription login" (Ihor, 2026-11-05): adding a subscription obtains **and stores** its login token and config,
so nothing has to be signed in again on a machine.

The GitHub and Atlassian sign-ins (S7.1a) and Slack's (S7.1e) share this store with five more kinds: "Tool sign-ins" below.

### The sign-in helper

The official CLIs run their own login in an isolated Linux sandbox that is thrown away afterwards: a throwaway Docker
container in development (macOS keeps Claude logins in the Keychain, so the login cannot run on the Mac itself), and
the server's own Linux container (a private tmpfs folder) in production. It is a login, not an agent run, and gets no
mounts and no credentials. The flow streams the provider's sign-in address to the page; for Claude, Ihor pastes the code
Anthropic shows back into the page; the helper's resulting files are read, encrypted and stored, and the sandbox is
deleted. Only Ihor completes a sign-in; nothing signs in for him.

As built in S3.2:

- **The port.** `LoginHelper` (`apps/server/src/platform/processes/login-helper/port.ts`) starts one login in a sandbox and gives
  its output as it comes, typing into its terminal, reading a file of its home, running a short command of the CLI once
  the login has finished (`run`, S7.1a: `gh auth token`) and killing it. A login runs behind `script`'s terminal unless
  its command says `tty: false` (the GitHub CLI's). `MWC_LOGIN_HELPER`
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
  kills the sandbox; a login already being stored finishes `done` even when cancelled or out of time.
- **Restarts.** A graceful shutdown cancels the sign-ins in progress and kills their sandboxes; every container is
  labelled `mwc.login-helper=1` and `mwc.instance=api-<port>`, so the next server on that port removes what a crash
  left (`docker ps --filter label=…`, then `docker rm --force`); the page retries a poll through a short outage and
  offers **Start again** when the server no longer knows the sign-in.
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

## Gateways

An AI gateway is an address a harness sends its AI requests to instead of the provider, with optional headers. Since
2026-11-10 gateways are **universal** (Ihor: "The gateway is a universal thing… I'm using 1 gateway for both, it's not
Claude Code gateway OR Codex, it could be both"): one gateway is a name, an address (its root) and headers, and serves
Claude Code and Codex alike, each CLI at its own **path** under the address. The paths are optional account details,
`accountMeta.paths: { claude?, codexChatgpt?, codexApiKey? }`, each left out taking its default (`DEFAULT_GATEWAY_PATHS`
of `@mwc/shared/credentials`). The headers are its secret, sealed like any other; the address and paths are not secret.
A gateway has no provider any more: the `accountMeta.provider` that gateways briefly had (2026-11-10, migration
`0016_gateway_provider`'s story) is neither read nor written, and older values are ignored.

- **The derived addresses** (`gatewayRouteOf`, `gatewayAddressOf`, `joinGatewayPath` of `@mwc/shared/credentials`;
  the server builds each turn's `HarnessGateway.baseUrl` with them, the drivers stay as they were):

  | Turn                                   | Route          | Default path         | Ihor's memory gateway (`http://127.0.0.1:8300`) |
  | -------------------------------------- | -------------- | -------------------- | ----------------------------------------------- |
  | Claude Code (any Claude subscription)  | `claude`       | `""`                 | `http://127.0.0.1:8300`                         |
  | Codex with a ChatGPT login (`codex_oauth`) | `codexChatgpt` | `/backend-api/codex` | `http://127.0.0.1:8300/backend-api/codex`  |
  | Codex with an OpenAI API key           | `codexApiKey`  | `/v1`                | `http://127.0.0.1:8300/v1`                      |

  The path is joined without double or trailing slashes (`/` or an empty path is the address itself), and an address
  that already ends with the path is kept as it is, so a gateway added as `…/backend-api/codex` still works for Codex.
  Ihor's Airia gateway `https://dev.gateway.airiadev.ai/anthropic` gives Claude Code that address itself (it serves
  Claude only so far; the Codex routes would add their paths to it).
- **Adding one:** `POST /api/me/subscriptions {kind: 'gateway', label, baseUrl, paths?, headers}`; 0 to 20 headers,
  each one line with a plain name; each path empty or starting with `/`, no spaces, `?` or `#`, at most 512 characters
  (`GATEWAY_PATH_MAX`). A `provider` sent by an older client is dropped. The web's form asks the name, the address
  ("Your gateway's root, e.g. http://127.0.0.1:8300; each CLI's path is added for it") and the headers, with an
  **Advanced: paths** fold showing the three paths with their defaults as placeholders (an empty one keeps its default).
- **Header previews** (2026-11-13, Ihor: "I do not see HEADERS... at least see in the way [like Airia's own key card]
  to understand if proper one configured"): every gateway in the API has `headers: [{ name, preview }]` in its order
  (null for the other kinds). The name is shown in full; the preview never holds the value: 16 characters or more show
  the first 8 and the last 4 (`agk-NTE5••••MHx8`), 8 to 15 the first 2 and the last 2, fewer only `••••`, and a scheme
  word (Bearer, Basic, Token, Bot, Digest, ApiKey, Key, DPoP, in any case) stays in front of its token's preview
  (`Bearer eyJhbGci••••abcd`). The server makes them when it seals the headers and stores them beside the sealed value
  (`credentials.header_previews`, migration `0034_gateway_header_previews`), so a list opens no secret. A gateway sealed
  before that migration has no previews: SQL cannot open a sealed value, so the first `GET /api/me/subscriptions` opens it
  once, records a `preview` use and stores them; one that does not open is listed with `headers: null`.
- **Changing one:** `PATCH /api/me/subscriptions/:id` takes `label`, and for a gateway `baseUrl`, `paths` (given paths
  replace its own; `{}` goes back to the defaults) and `headers`, the whole list the gateway keeps, in order, each
  `{ name, from?, value? }`: a stored header keeps its value while no `value` is given; `from` renames a stored one; a
  name not stored is new and needs a value; a stored header left out is removed. Names differ in any case, 20 at most.
  A `from` the gateway has not is 422 `header_not_found`, a new header without a value 422 `header_value_required`, an
  address, paths or headers for another kind 422 `not_a_gateway`. Changing headers opens the stored ones (an
  `edit_headers` use), seals the new set with its previews, and writes per change an `update` audit row with names only
  (`header`: old name → new name, null for added or removed; `header_value`: that header's value replaced), and a
  `replace_secret` row (purpose `edit_headers`); the same headers write nothing. The `preview` and `edit_headers` uses
  leave `last_used_at` as it was: they send nothing anywhere.
- **On the page:** each gateway card shows the address and, in small text, the derived addresses ("Claude Code → …",
  "Codex (ChatGPT) → …", "Codex (API key) → …"), each header as `name: preview` in monospace, and the profiles that
  include it. The name is renamed in place; **Edit** opens the address, the header rows (name, a value field showing
  "unchanged" until a new value is typed, remove; **Add header**) and the paths fold in place, with Save and Cancel. A
  value is never shown or copied in full: the store stays write-only.
- **In a profile:** any profile takes any of its owner's gateways, Claude and OpenAI profiles alike (the provider check
  and its 422 `gateway_provider_mismatch` are gone); nothing in the database enforces a provider match (migration
  `0016_gateway_provider` dropped the last CHECK). Every profile's gateway select lists all the person's gateways.
- **The profile decides.** The profile's gateway, or none, decides for every turn and chat terminal of its agents on
  any machine, whatever that machine's own Claude Code or Codex settings say: Claude Code gets a private settings file
  (`--settings`, the gateway's address and headers, or Anthropic's own address and no headers without one) over a
  machine's `~/.claude/settings.json`; Codex gets the gateway as a custom model provider in config overrides (or its
  built-in OpenAI provider without one), which win over a `config.toml` in its home folder (the runner's own, so the
  machine's `~/.codex` is never read, or the placement's config folder). How each reaches the process: docs/harness.md,
  "Credentials and gateways".
- **Not yet:** the `x-memory-*` headers set per chat (a later step); reaching a gateway on Ihor's Mac from the devbox
  (`127.0.0.1` there is the devbox itself).

## Profiles

Since 2026-11-13 a profile is **generic** (Ihor: "I wanted to have PROFILES not Claude Profiles... i.e. GENERIC
profile, which has under the hood, assigning Claude/GH/Jira etc... Profile on our end serves full config"): a person's
named profile with optional **parts**, any of which can be added or removed, and **one AI part at most** (Ihor, the
same day: "we have to LOCK in Profile, that we can Choose EITHER 1 harness EITHER 2nd one... NOT BOTH simultaneously!"):

| Part      | Holds                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------- |
| Claude    | one Claude subscription (`claude_oauth`, `claude_setup_token`, `anthropic_api_key`), any gateway, a model, an effort and a mode |
| OpenAI    | one OpenAI subscription (`codex_oauth`, `openai_api_key`), any gateway, a model, an effort and a mode |
| GitHub    | one GitHub sign-in (`github_oauth`, `github_token`) and its rights ("Tool parts" below)            |
| Atlassian | one Atlassian sign-in (`atlassian_api_token`) and its rights                                       |
| Slack     | one Slack sign-in (`slack_bot_token`, `slack_user_token`) and its rights ("Slack" below)           |

Slack is the third tool part since S7.1e (migration `0036_slack_part`). A profile has a Claude part or an OpenAI part, or neither (a GitHub-only
or Atlassian-only profile), never both. An agent gets one profile (`agents.profile_id`) with an AI part, and its harness
follows that part: Claude Code on a Claude part, Codex on an OpenAI part. Its GitHub and Atlassian access are the
profile's tool parts. A person makes as many profiles as they
like; a profile never moves a credential into a company: it is a reference the server resolves at run time. Each
person has a default per AI part and company for the agents they hire. Built first in S3.4 (bundles), one provider per
profile from 2026-11-10 (migration `0015_profile_provider`), with separate GitHub and Atlassian profiles in S7.1b, and
generic since migration `0032_generic_profiles`, with one AI part since `0033_one_ai_part`.

- **The row.** `access_profiles` is personal (an owner, no company): `name` (1–80, unique per owner) and its parts'
  columns, with no provider:
  - each AI part: `<part>_part` (it has the part), `<part>_credential_id` and `<part>_gateway_credential_id` (keys to
    `credentials`, `on delete set null`), `<part>_model` (1–100, null for the harness's default), `<part>_effort`
    (null for the default) and `<part>_mode` (since `0035_profile_mode`: one of its harness's modes, null for the
    default, Manual or Ask; "Mode" below), for `claude` and `openai`;
  - each tool part: `<tool>_credential_id` and `<tool>_rights` (jsonb), for `github`, `atlassian` and `slack`; the part is
    there when its rights are.

  CHECKs keep one AI part at most (`access_profiles_one_ai_part_check`: `not (claude_part and openai_part)`), an AI
  part's fields off while the part is not there, a model's length, the stored efforts, each part's own modes, a tool sign-in
  only with its rights, and rights an object. `PROFILE_AI_COLUMNS`, `PROFILE_TOOL_COLUMNS` and `aiPartOf` (`@mwc/db`,
  `src/profile-parts.ts`) map the parts to their columns. **Why typed columns rather than one jsonb or a parts table:**
  every credential needs a real column for its foreign key, so removing a credential lets go of it; typed columns keep
  the model and effort CHECKs, one row read per profile (a turn reads its harness's part straight from the row), and
  per-field audit rows; a part is two to five columns, and Slack's was two more (`0036_slack_part`).
- **Credentials.** Each is one of the owner's own, of a kind its place takes (`PROVIDER_KINDS`, `GATEWAY_KINDS`,
  `TOOL_KINDS`, `fitsProvider`, `fitsGateway`, `fitsTool`), never a revoked one when it is put in; one revoked while in
  place stays until it is replaced. Removing a credential empties its place, and the part stays (an AI part without a
  subscription cannot run: a turn says `profile_empty`).
- **Managing them:** `/api/me/access-profiles` (`GET`, `POST`, `PATCH`/`DELETE /:profileId`), the owner's Clerk session
  only. `POST` takes `{ name, parts? }`, `PATCH` `{ name?, parts? }`; `parts` is `{ claude?, openai?, github?, atlassian?, slack? }`:
  - an AI part `{ credentialId?, gatewayCredentialId?, model?, effort?, mode? }` (a mode of its harness: Claude Code's
    five on a Claude part, Codex's three on an OpenAI part; another is a 400), a tool part `{ credentialId?, rights? }`;
  - a part the profile has not is added with what it gives, the rest empty (an AI part's mode its default, Manual or
    Ask; a tool part's rights its tool's safe defaults); a part it has changes only what is given (the same values write nothing); null removes the part and
    empties its columns; a part left out is kept.

  Refusals, all 422: none of the owner's credential (`credential_not_found`), a kind its place does not take
  (`credential_kind_mismatch`: an AI part's subscription is its provider's, a gateway any gateway, a tool part's
  sign-in its tool's), a revoked one (`credential_revoked`), a second AI part (`one_ai_part`: "This profile already has
  a Claude part; a profile runs one AI"; a new profile given both: "A profile runs one AI: give it a Claude part or an
  OpenAI part, not both"; removing one and adding the other in one change is a swap, and fine), a model of the other
  provider (`model_provider_mismatch`), an effort the model does not take (`effort_unsupported`, checked against what
  the part runs after the change), removing an AI part agents run on (`profile_part_in_use`, naming them: "Developer
  and QA run on this profile's Claude part: give them another profile first"; a swap too, since it would change their
  harness). A model id that does not look like one, an unknown part or field, rights of
  the other tool's shape are 400; a taken name 409. Every profile shows `parts` (each null or the part with its
  credentials as metadata, never a secret) and the agents using it in the owner's companies.
- **Giving one to an agent:** `profileId` on `POST`/`PATCH /api/companies/:companyId/agents`. Only the profile's owner
  gives it, signed in (an API key: 403 `session_required`), in a company where they are an admin or owner; someone
  else's profile is 403 `profile_not_yours`, none 422 `profile_not_found`, one with no AI part 422 `profile_no_ai_part`
  ("This profile has no AI part"). Any admin or owner takes a profile off (`null`), with a session or an API key. Agents and the chart show `profile: {id, name,
  ownerUserId, ownerName, parts}`: each AI part's model and effort, each tool part's account, site and rights; never a
  subscription, its account or a secret. `runsWith: {model, effort, mode, provider}` is what the agent runs: its
  profile's AI part's model, effort and mode (null without a profile).
- **The harness follows the profile** (since 2026-11-13): giving a profile, on hire or with `PATCH`, sets
  `agents.harness` from its AI part on the server (`claude_code` for Claude, `codex` for OpenAI), audited like any
  field. `harness` is no longer a field of the agent routes (one sent is ignored); it stays a stored column, always
  derived. Taking the profile off keeps the harness; an agent hired without a profile runs `claude_code` until it gets
  one. A new harness leaves the agent's chats as they were, as a harness change always did: each keeps the harness it
  began on and its next prompt is refused with `harness_changed` ("start a new chat"); a turn already running finishes.
  Nothing refuses the change while a turn runs (the old harness change did not either).
- **The defaults:** `memberships.default_claude_profile_id` and `default_openai_profile_id` stay, each pointing at a
  generic profile with that part (the simplest shape, and no data lost). `PUT /api/companies/:companyId/me/default-profile`
  with `{ provider, profileId }` sets the caller's own default for that AI part's agents (the rule of giving, and 422
  `profile_part_missing` for a profile without the part; clearing one is any active member's). An agent hired without
  `profileId` gets the hirer's Claude default, else their OpenAI default, each only while it still has its part (else
  none), and the harness that follows from it. The Hire page starts from the same.
- **A chat's own profile** (S5.1b) follows the same rules: only the owner's, with the part of the chat's harness
  (`profile_part_missing`); a turn refuses a profile without that part the same way, and a part without a subscription
  with `profile_empty`. The part's gateway goes with every turn and terminal of its harness, and its model and effort are
  the turn's (the chat's own profile's, else the agent's).
- **Leaving a company** (every path of the org chart's lifecycle) takes the person's profiles off the company's agents
  in the same transaction. A re-activation does not put them back.
- **Removing a profile** takes it off its agents, chats and its owner's defaults through the foreign keys, with the
  audit rows of the agents and defaults in its company, by the owner.
- **Audit:** profile create, update and delete (personal rows: `name`, `ownerUserId` and every part column:
  `claudePart`, `claudeCredentialId`, `claudeGatewayCredentialId`, `claudeModel`, `claudeEffort`, `claudeMode`, the
  same for `openai`,
  `githubCredentialId`, `githubRights`, `atlassianCredentialId`, `atlassianRights`, `slackCredentialId`, `slackRights`), an agent's `profileId`, a
  membership's `defaultClaudeProfileId` and `defaultOpenaiProfileId`.
- **The web** (the **Profiles** page; the rail and its links say Profiles, the route stays `/profiles`; labels only):
  - one list of profile cards, with no provider groups or badges. Each card has its name (renamed in place) and Delete,
    then its parts as sections in a fixed order (Claude, OpenAI, GitHub, Atlassian, Slack), each with **Remove**: an AI part's
    **Subscription**, **Gateway**, **Model**, **Effort** and **Mode** (a segmented control of its harness's modes); a tool part's **Sign-in** and rights ("Tool parts" below);
    each saved as it changes. A row of **Add Claude**, **Add OpenAI**, **Add GitHub**, **Add Atlassian** and **Add Slack** adds the
    missing ones (each with the person's first credential of that kind); Add Claude and Add OpenAI show only while the
    profile has neither, so once one is added the other's button is gone, and removing it brings both back (still
    refused while agents run on it). "Used by: Developer, QA" names the agents.
    No descriptions under the fields, no lede under the title.
  - **New profile** asks for a name only. `?new=1` (an agent form's **Make one**) opens it.
  - **Defaults for agents I hire** has a select per company for Claude Code agents and for Codex agents, each listing
    the profiles with that part.
  - The agent form has no harness choice (since 2026-11-13: the profile decides it) and one **Profile** picker: each
    profile as its name and its AI in short ("Claude Code 2nd · Claude"), those without an AI part disabled ("Work
    tools · No AI part"); choosing one sets the harness, and the Hire page starts from the hirer's Claude default, else
    their OpenAI one. Under it, once, a quiet line of the chosen profile's parts (`profileLine`): "Claude · Opus 5.5 ·
    High · GitHub: push, PRs · AiriaLLC/* · Atlassian: Jira read (AP) · Confluence write" (a model, effort and mode
    only when not the defaults; never the subscription's account). Since 2026-11-13 it has no Permissions either (the
    profile's Mode decides; the Hire page the same), and **Your profiles** as the link. The agent page's facts show
    it once, as **Access**; agent cards, the agents
    table, the header and the chart show the model and effort the agent runs, and a chat's picker lists the profiles
    with the part of its harness.

**From bundles to one provider** (migration `0015_profile_provider`, its `-- custom:` data step, 2026-11-10): a profile
with only a Claude subscription, or none, became a Claude profile (keeping its gateway); one with only an OpenAI
subscription an OpenAI profile (its gateway let go: only Claude profiles had one then); one with both stayed a Claude
profile with its gateway, and a new OpenAI profile of the same owner, "<name> · OpenAI" (" · OpenAI 2", " 3"... when
taken, the name cut to 80 characters), took its OpenAI subscription, its `codex` agents and chats, and the OpenAI default
of members whose default it was (the Claude default stayed the original). Each member's default moved to its provider's
column, and an agent or chat left on a profile of the other provider than its harness lost it. The audit log has each
new profile, agent and chat moved or cleared, OpenAI default set and gateway let go, by the system, with the request id
`migration:0015_profile_provider`.

### Model and effort

The catalogue is `@mwc/shared/models` (`MODEL_CATALOGUE`): for each provider the models offered by name, each with its
context window and the efforts it takes, and the provider's own levels (`PROVIDER_EFFORTS`). The forms offer those, the
provider's default (null: the harness picks), or another id typed in. `contextWindowOf` reads the catalogue's windows
first; a profile with no model is sized by `DEFAULT_WINDOWS` (`profileWindowOf`).

| Provider | Models (id, label) | Window | Efforts |
| --- | --- | --- | --- |
| Claude (Claude Code's `--effort`) | `claude-opus-5-5` Opus 5.5, `claude-sonnet-5-5` Sonnet 5.5, `claude-haiku-5-5` Haiku 5.5, `claude-fable-5-1` Fable 5.1 | 1M | low, medium, high, xhigh, max |
| OpenAI (Codex's `model_reasoning_effort`) | `gpt-6.1-sol` GPT-6.1 Sol, `gpt-6.1-terra` GPT-6.1 Terra | 475k | low, medium, high, xhigh, max, ultra |
| | `gpt-6-astra` GPT-6 Astra, `gpt-6-sol` GPT-6 Sol, `gpt-5.6-sol` GPT-5.6 Sol, `gpt-5.6-terra` GPT-5.6 Terra | 258.4k | low, medium, high, xhigh, max, ultra |
| | `gpt-6-luna` GPT-6 Luna, `gpt-5.6-luna` GPT-5.6 Luna | 258.4k | low to max |
| | `gpt-5.5` GPT-5.5 | 258.4k | low to xhigh |

OpenAI's list is what Codex shows a ChatGPT sign-in: the model presets compiled into its 0.162.1 binary, with GPT-6.1
Terra from 0.166's `models_cache.json` (`visibility: list`, in its priority order; the hidden reserve and auto-review
models are left out; GPT-5.5 is no longer in 0.166's list and stays for profiles that name it), each with its
`supported_reasoning_levels` and the window Codex shows: its `context_window` (500k for GPT-6.1, 272k for the rest;
`max_context_window` 872k is not used) times `effective_context_window_percent` (95). A profile with no model is sized
as GPT-6.1 Sol, the first of Codex's list; a turn's own reading names the model Codex ran (docs/harness.md, "Codex's
context reading"). Codex's config also
knows `none` and `minimal`, which none of its listed models takes. `ultra` is the deepest level and hands parts of the
task to helpers. The stored levels are the union (`Effort` of `@mwc/shared/enums`); a profile's effort is one its model
takes, or its provider's for a typed-in model or the default. A turn and a terminal hand the harness the profile's model
and effort (none: the harness's own default); Codex's old default marker `codex-default` and a Claude id on Codex still
become Codex's own default (`turnModel`), and an effort the harness does not take is left out (`turnEffort`).

**From agents to profiles** (migration `0017_profile_model`, its `-- custom:` data step, 2026-11-10): each profile took
the model most used by the agents that had it (archived ones too) and, counted on its own, the effort most used by them,
a tie going to the newest agent's; the model became null (the provider's default) when it was Codex's marker
`codex-default` or a model of the other provider (a Claude id or alias on an OpenAI profile, a GPT, o-series or Codex id
on a Claude one). A profile no agent used kept both null. Then `agents.model` and `agents.effort` were dropped
(`agents.harness` stays). The audit log has each value set, by the system, with the request id
`migration:0017_profile_model`.

### Mode

Since 2026-11-13 (Ihor: "I would love to set it in the PROFILE, with an ability to change in the CHAT") whether an
agent's turns ask before a tool is its profile's AI part's **mode**, no longer the agent's placement (its old
Permissions: Ask me / Skip prompts). The modes are `@mwc/shared/modes` (`MODES`, `DEFAULT_MODES`), each with a label,
a short label (the composer's Mode pill: Manual's is "Ask") and one line:

| Part | Mode (stored) | Label | What it does | Default |
| --- | --- | --- | --- | --- |
| Claude (Claude Code's `--permission-mode` values) | `manual` | Manual | Asks before each edit and command | yes |
| | `acceptEdits` | Accept edits | Edits files without asking; asks before commands | |
| | `plan` | Plan | Explores and writes a plan; changes nothing | |
| | `auto` | Auto | Runs safe actions itself; asks before risky ones | |
| | `bypassPermissions` | Skip prompts (full trust) | Never asks: runs every tool | |
| OpenAI (Codex's sandbox and approvals) | `ask` | Ask | Reads only; asks before any change | yes |
| | `auto` | Auto | Works in its folder; asks for anything outside | |
| | `full` | Full trust | Never asks: no prompts, no sandbox | |

How each reaches its harness's command line is docs/harness.md, "Modes". In a chat turn nobody answers a prompt: what
would ask is refused, the model is told, and the thread shows a "Refused for permission" notice (in the terminal the
harness asks the person). A chat may run its next turns in another mode, model and effort than its profile's (its
overrides, docs/harness.md "Modes"); the composer's Mode and Model menus set them.

**From placements to profiles** (migration `0035_profile_mode`, its `-- custom:` data step): each profile with an AI part
took its mode from the agents running on it (not archived, with a placement): Skip prompts (`bypassPermissions`) on a
Claude part or Full trust (`full`) on an OpenAI part when every one of them had `bypass`; else, all `ask` or a mix,
Manual or Ask. A profile whose agents differed is named in a notice when the migration runs (`migration
0035_profile_mode: the profile "…" (…) runs in Manual or Ask: its agents differed: A (bypass), B (ask)`). A profile no
such agent used kept the default (null). Then `agent_placements.permission_policy` was dropped. The audit log has each
mode set, by the system, with the request id `migration:0035_profile_mode`. Note for Codex: the old `ask` gave Codex the
workspace-write sandbox, which is now Auto; a Codex profile migrated to Ask runs read-only until it is set to Auto.

## Tool sign-ins

Built in S7.1a (2026-11-12). Ihor decided that day: Atlassian signs in with an API token for now (an Atlassian OAuth
2.0 app is the later upgrade, once there is a public address for its callback), GitHub and Atlassian get tool profiles
of their own in S7.1b (since 2026-11-13 parts of a generic profile, "Tool parts" below), and work stops after each step
for his live test.

A tool sign-in lives in the same personal store as the subscriptions, with five more kinds (Slack's two since S7.1e). Each is sealed like the
others, write-only, managed only in a Clerk session (an API key is 403 `session_required`) and audited, and every
server-side use of its secret is a `credential_uses` row (purpose `tool_check`). Tool sign-ins never power an AI turn:
they go only in a profile's tool part of their tool; as an AI part's subscription or gateway one is 422
`credential_kind_mismatch`. They have no plan limits: `GET /api/me/subscriptions/limits` leaves them out, so the home
page's widget never shows them. `TOOL_CREDENTIAL_KINDS`, `isToolKind`, `TOOL_PROVIDER_OF` and `atlassianSite` are
`@mwc/shared/credentials`'.

| Kind                  | How it is added                                                     | Sealed                    | Account details (`accountMeta`)                               | Its check |
| --------------------- | ------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------- | --------- |
| `github_oauth`        | **Sign in with GitHub**: the GitHub CLI's device sign-in in the sign-in helper | `{ token }` (`gh auth token`) | `host` (`github.com`), `login`, `name`, `scopes`; its public email is the account email | GitHub `GET https://api.github.com/user` |
| `github_token`        | paste a classic (`ghp_`) or fine-grained (`github_pat_`) personal access token | `{ token }`           | the same, and `tokenType` (`classic` or `fine_grained`); no `scopes` for a fine-grained token | the same |
| `atlassian_api_token` | the site, the account email and an API token                        | `{ site, email, token }`  | `site`, `jira` and `confluence` (true when that product answered), `accountId`, `displayName`; the email is the account email | Jira `GET https://<site>/rest/api/3/myself` and Confluence `GET https://<site>/wiki/rest/api/user/current`, basic auth, side by side |
| `slack_bot_token`     | paste a Slack app's Bot User OAuth Token (`xoxb-`); S7.1e           | `{ token }`               | `team` (the workspace), `teamId`, `url`, `user` (the bot's name), `userId`, `botId`, `enterpriseId` when there is one, `scopes` (from `X-OAuth-Scopes`) | Slack `POST https://slack.com/api/auth.test`, bearer |
| `slack_user_token`    | paste a Slack app's User OAuth Token (`xoxp-`), which acts and posts as that person | `{ token }` | the same, with the person's name and no `botId` | the same |

Migration `0029_tool_sign_ins` widened the kind CHECK and added `credentials.checked_at` (a tool sign-in's last check
with its provider; null for the AI kinds, whose limits checks live in the server's memory) and `check_error` (why it did
not finish: `ToolCheckError` of `@mwc/shared/enums`, with its CHECK). The API shows both on every subscription:
`checkedAt` and `checkError: { code, message } | null`.

### Sign in with GitHub

The GitHub CLI's own device sign-in, as Ihor's Mac's `gh` was signed in, run in the sign-in helper's throwaway sandbox
like the Claude and OpenAI logins (no app to register):

```
gh auth login --hostname github.com --git-protocol https --web --scopes workflow --insecure-storage
```

- **Why the two extra flags:** `--scopes workflow` is what an interactive https login adds when it sets up git's
  credentials, so pushes that change workflow files work later (S7.1d); the token gets `repo`, `read:org`, `gist` and
  `workflow`. `--insecure-storage` because the sandbox has no keyring: the token goes to the throwaway home's
  `~/.config/gh/hosts.yml`.
- **No terminal:** the CLI runs with plain pipes (`LoginCommand.tty: false`, so not behind `script`) and
  `GH_PROMPT_DISABLED=1`, so it never prompts. gh 2.103.3 then prints, and waits:

  ```
  ! First copy your one-time code: XXXX-XXXX
  Open this URL to continue in your web browser: https://github.com/login/device
  ```

  The address is passed on only when it is https `github.com/login/device`; the code is `[A-Z0-9]{4}-[A-Z0-9]{4}`.
- **Done:** once Ihor enters the code on GitHub, the CLI exits 0. The flow then runs `gh auth token --hostname
  github.com` and `gh api user --include` in the sandbox (`LoginSandbox.run`: `docker exec` with no terminal, or the
  local home's own environment), stores `github_oauth` named "GitHub · <login>" with its first check (`checked_at`; no
  use is recorded, since GitHub's own CLI made that check) and removes the sandbox. A token or an account that is not
  there fails the sign-in in plain words.
- **The same sessions** as the other sign-ins: `POST /api/me/subscriptions/sign-in {provider: 'github'}`, the states,
  10 minutes, one at a time per person, Cancel, and Sign in again with `credentialId` of a `github_oauth` (422
  `sign_in_kind_mismatch` for another kind).
- **The image:** `deploy/Dockerfile.login` adds gh 2.103.3 (published 2026-10-26, pinned 2026-11-12): the release
  tarball for the build machine's architecture, checked against the SHA-256 GitHub published for it, with
  `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `GH_TELEMETRY=false` and `GH_SPINNER_DISABLED=1`. The local helper
  gives a login the same switches. A changed Dockerfile is a new tag, so the dev server builds the image again on the
  next sign-in.

### Adding a token, Atlassian, and Check again

- **Adding:** `POST /api/me/subscriptions/tools` takes `{ kind: 'github_token', label?, token }` or `{ kind:
  'atlassian_api_token', label?, site, email, token }`. A light format check first (400): a GitHub token is one word of
  letters, digits and `_` starting with `ghp_` or `github_pat_`; a site as typed (`https://airia.atlassian.net/jira/`,
  `airia.atlassian.net` or just `airia`) becomes its host `<name>.atlassian.net` (`atlassianSite`), anything else is
  refused; the email is trimmed. Then the provider is asked, and only once it names the account is the secret sealed,
  with that check and its `tool_check` use: 201, named "GitHub · <login>" or "Atlassian · <site>" unless a name is
  given. A refusal stores nothing: 422 `tool_sign_in_refused` ("GitHub did not accept this token.", "Neither Jira nor
  Confluence answered on airia.atlassian.net."), 502 `provider_unavailable`, `rate_limited`, `invalid_response` or
  `check_failed`.
- **A new secret in place:** the same request with `credentialId` (a card's Sign in again for a pasted token or
  Atlassian) checks the new secret, then replaces the sign-in's in place (`renewCredentialLogin`: same id and name, set
  `active` with the new account, a `replace_secret` audit row). 404 for none of the caller's, 422 `tool_kind_mismatch`
  for another kind, 422 `credential_revoked`.
- **Check again:** `POST /api/me/subscriptions/:credentialId/check` opens the secret for `tool_check` and asks the
  provider now: 200 with the sign-in after its check; 404, or 422 `not_a_tool` for an AI subscription and
  `credential_revoked`.
- **Reading GitHub's answer:** 200 with a login is the account, its scopes from `X-OAuth-Scopes` (none for a
  fine-grained token); 401 `needs_sign_in`; 403 is `rate_limited` when `X-RateLimit-Remaining` is 0, else `refused`;
  429 `rate_limited`; 5xx, a network failure or the 10-second deadline `provider_unavailable`; anything else
  `invalid_response`. Headers: the bearer, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
  `User-Agent: mwc`.
- **Reading Atlassian's:** each product that answers 200 with the account counts (Confluence's anonymous user, `type:
  anonymous`, does not); the name and id come from Jira, else Confluence. When neither does: a 401 (or the anonymous
  user) is `needs_sign_in`, then a 429, then an outage; two products that are not there (404) or not open to the
  account (403) are `no_products`; the rest `invalid_response`.
- **What a check keeps:** working, the sign-in turns `active` with the account the provider names; a 401 sets it
  `needs_sign_in`; a check that does not finish keeps its status and stores why (`check_error`, shown in words: "GitHub
  did not answer the last check."). A change of status or account is audited, by the person for Check again and by the
  system for the daily check; the check's own time and error are bookkeeping, like `last_used_at`. Every provider call
  goes through `providerFetch` with redirects refused, so no test reaches GitHub or Atlassian.
- **The daily check:** a job of the jobs loop (`toolChecks`, MWC_JOBS) looks every 10 minutes for up to 10 tool
  sign-ins due: never checked, last checked a day ago or more, or an hour ago or more when that check did not finish;
  not revoked; one that needs signing in again too, so a token that works again turns active. The due list is the
  credentials module's one raw read, `modules/credentials/repo/checks-due.ts` (in the Biome exemption, as the
  notifications' and Lead wake-ups' due lists); each is then opened, checked and changed through its owner's personal
  layer. AI limits are checked when a page asks for them; tool sign-ins have no page watching them, so the server
  checks them on its own schedule.

### The Tools part of the Subscriptions page

Under the AI subscriptions, **Tools**: one card per GitHub or Atlassian sign-in, with its logo and kind, its status, its
name (renamed in place), the account it acts as ("@login · Name", or "Name · email" and the site), GitHub's scopes (or
"Fine-grained") or Jira and Confluence (one that does not answer struck through), when it was last checked and why that
check did not finish; **Check again**, **Sign in again** (Sign in with GitHub again, or a new token or Atlassian API
token for the same sign-in) and **Remove**. **Add a tool** opens a sheet: GitHub, **Sign in with GitHub**
(recommended) or **Paste a token**; Atlassian, **Jira and Confluence** (site, email, API token, with **Create an API
token** linking to id.atlassian.com/manage-profile/security/api-tokens). The marks are inline SVGs (`ProviderLogo`:
`github`, `atlassian`).

### How to test it (Ihor)

1. Merge, then restart the dev API (`pnpm dev`): migration `0029_tool_sign_ins` runs on start. Docker Desktop runs.
2. Subscriptions page → **Tools** → **Add a tool** → **Sign in with GitHub**. The first sign-in builds the new sign-in
   image (a minute or two) unless it was built already. Open github.com/login/device from the sheet, enter the code it
   shows, approve; the card shows "GitHub · <login>", the scopes and "Checked just now".
3. **Add a tool** → **Paste a token** (optional): a classic or fine-grained token; the card shows its account and type.
4. **Add a tool** → **Jira and Confluence**: the site (`airia` is enough), the account email and an API token from
   **Create an API token**; the card shows the name, the email, the site, and whether Jira and Confluence answered.
5. **Check again** on a card asks the provider at once. Revoking a token at the provider and checking again shows
   "Needs sign-in" and **Sign in again** in blue.

## Tool parts

A profile's **GitHub** and **Atlassian** parts (S7.1b; built on 2026-11-12 as separate profiles picked per agent, parts
of one profile since 2026-11-13): each one of its owner's sign-ins of that tool and the rights the agents given the
profile have there. Their columns, API and refusals are "Profiles" above; here, what the rights are and what agents are
told.

- **Rights** (`GitHubRights`, `AtlassianRights` of `@mwc/shared/credentials`, in `credentials/tool-rights.ts`), unchanged
  from S7.1b: zod schemas the API, the agents' views and the briefing all parse with; stored rights that do not parse as
  their tool's count as none at all (`storedRights`), so a damaged row never grants anything. The tools check them on
  every call (Atlassian's since S7.1c, "Atlassian tools" below; GitHub's since S7.1d, "GitHub tools" below).

  | Part      | Right              | Values                                                                                         |
  | --------- | ------------------ | ---------------------------------------------------------------------------------------------- |
  | GitHub    | `repos`            | `all`, or up to 100 of `owner/name` and `owner/*` (repeats dropped, case ignored); empty reaches none |
  |           | `push`             | push branches                                                                                  |
  |           | `pullRequests`     | open and update pull requests                                                                  |
  | Atlassian | `jira`             | `off`, `read`, `changes` (comment, transition, create, edit summary, description and labels)  |
  |           | `jiraProjects`     | `all`, or project keys (`AP`; typed lower-case, stored upper-case)                             |
  |           | `confluence`       | `off`, `read`, `write` (create and update pages)                                               |
  |           | `confluenceSpaces` | `all`, or space keys (`ENG`, a personal space's `~` key)                                       |
  | Slack     | `read`             | channels' history and threads, the channel list, users (S7.1e, "Slack" below)                  |
  |           | `post`             | post into channels and threads                                                                 |
  |           | `channels`         | `all`, or channel names (`general`: typed with or without `#`, stored lower-case) and ids (`C0123ABCD`) |
  |           | `dms`              | `off`, `read`, `post` (direct messages and group DMs)                                          |
  |           | `search`           | search messages (a user token with `search:read`, and `read`)                                  |
  |           | `react`            | add reactions                                                                                  |

  GitHub reads in the repositories it reaches, always. A GitHub part never merges, deletes, force-pushes or pushes to a
  default branch, an Atlassian part never deletes or archives, and a Slack part never mentions `@here`, `@channel` or
  `@everyone`, deletes, edits others' messages, invites, kicks or administers: those are no options. A new part starts at
  the safe end (`defaultRights`): GitHub reaches no repository and only reads; Atlassian reads Jira and Confluence
  everywhere and writes nowhere; Slack reads every channel and posts nowhere, with DMs, search and reactions off.
- **The briefing:** an agent's briefing ends with one line per tool part of its profile (`toolBriefingLine` of
  `credentials/tool-words.ts`, GitHub's, Atlassian's then Slack's), what it may do there and as whom, and which of Most Wanted's
  tools use it: Atlassian's since S7.1c, GitHub's since S7.1d (until then it said the access was configured and its tools
  would come), with git and gh on the machine when the part may push:

  ```
  - GitHub: as ihorherasko; may read, push branches and open and update pull requests in AiriaLLC/*; never merges, force-pushes, deletes or pushes to a default branch. Use it with your Most Wanted tools, named as on GitHub’s MCP server (search_pull_requests, pull_request_read, create_pull_request, …); in your turns git and gh on your machine use it too.
  - Atlassian (airia.atlassian.net): as Ihor Herasko; Jira: may read issues in AP; Confluence: may read, create and update pages in ENG; never deletes or archives. Use it with your Most Wanted tools, named as on Atlassian’s remote MCP (searchJiraIssuesUsingJql, getJiraIssue, getConfluencePage, …).
  ```

  A part without a sign-in says "your profile has no sign-in for it now, so no access." Names past 25 are
  counted.
- **The web:** a tool part's section has **Sign-in** (the person's sign-ins of that tool; **Add a sign-in** links to
  Subscriptions when there is none) and the rights: GitHub's **Repositories** (**All repositories**, else chips of
  `owner/name` and `owner/*`), **Push branches** and **Pull requests**; Atlassian's **Jira** (Off, Read, Changes) and
  **Confluence** (Off, Read, Write), each with **All projects** or **All spaces**, else key chips.

**From one provider to generic profiles** (migration `0032_generic_profiles`, its `-- custom:` data step, 2026-11-13;
it replaced the branch's first `0032_profile_tool_parts` before it was merged, so nothing is deleted): every profile kept
its id, name and owner and got the one part its provider was, with that provider's columns (a Claude or OpenAI
profile its subscription, gateway, model and effort; a GitHub or Atlassian profile its sign-in and rights). Ihor's two
tool-only profiles, "Airia GitHub acc - Ihor" and "Airia Atlassian acc - Ihor", stay as profiles with just their GitHub
or Atlassian part. An agent's GitHub or Atlassian profile was also copied into its profile as that tool's part, also on
every other profile its agents were on; the migration refuses, changing nothing and naming what to fix, when an agent
has a tool profile but no profile, when the tool profile is another person's than the agent's profile, or when the agents
on one profile do not all have the same GitHub profile (or the same Atlassian profile; none counts as one). Then the
provider and its columns, the rights and the agents' two columns went. The audit log has each profile's provider going,
each part copied in and each agent's tool profile taken off, by the system, with the request id
`migration:0032_generic_profiles`.

### How to test it (Ihor)

1. Merge, then restart the dev API (`pnpm dev`): migration `0032_generic_profiles` runs on start and deletes nothing.
   Reload the web.
2. The rail says **Profiles**. Every profile is one card: your Claude ones with a Claude section, your OpenAI ones with
   an OpenAI section, "Airia GitHub acc - Ihor" with a GitHub section, "Airia Atlassian acc - Ihor" with an Atlassian
   section, and Add buttons for the missing parts.
3. On the profile your DEVBOX agents use, **Add GitHub**: it takes your GitHub sign-in; under **Repositories** type
   `AiriaLLC/*` and Enter, switch on **Push branches** and **Pull requests**. **Add Atlassian**: **Jira** Read,
   **Confluence** Read or Write. Each change saves at once. (Or delete the two tool-only profiles, or keep them.)
4. The same profile has no **Add OpenAI** any more: a profile runs one AI (since `0033_one_ai_part`). A Codex agent
   gets a profile of its own with an OpenAI part.
5. **Remove** on its Claude section while Claude Code agents use it: refused, naming them.
6. **Agents** → a DEVBOX agent → **How it works**: no Harness, one **Profile** picker listing "name · Claude" or
   "name · OpenAI"; the tool-only profiles are greyed out ("No AI part"). Under it, once: "Claude · … · GitHub: push,
   PRs · AiriaLLC/* · Atlassian: Jira read · Confluence …". Picking an OpenAI profile makes it a Codex agent on Save.
   The facts at the top show that line once, as **Access**, and **Instructions** → **From the company** ends with the
   GitHub and Atlassian lines.
7. Merge, restart the dev API: migration `0033_one_ai_part` runs on start, adds the CHECK and changes no row (it refuses,
   naming the profile, if one had both parts).

## Atlassian tools

Built in S7.1c (2026-11-13). An agent whose turn runs on a profile with an Atlassian part reads and, by its rights,
changes Jira and Confluence through tools the **server** answers: the sign-in's token is opened on the server for each
call and never reaches the machine. Ihor's habit on his Mac is Atlassian's remote MCP (`mcp.atlassian.com`), so the tools
keep its names and input shapes, and prompts and skills carry over; `cloudId` is taken and ignored (the profile names the
site). They reach the turn through the runner's MCP bridge as the server's own tools (docs/harness.md, "Server tools"),
for Claude Code and Codex alike.

| Rights | Tools |
| --- | --- |
| Jira `read` or `changes` | `searchJiraIssuesUsingJql {jql, fields?, maxResults?, nextPageToken?}`, `getJiraIssue {issueIdOrKey, fields?, expand?}`, `getTransitionsForJiraIssue {issueIdOrKey}`, `getVisibleJiraProjects {searchString?, maxResults?}`, `lookupJiraAccountId {searchString}` |
| Jira `changes` | `addCommentToJiraIssue {issueIdOrKey, commentBody, contentFormat?}`, `transitionJiraIssue {issueIdOrKey, transition: {id}}`, `createJiraIssue {projectKey, issueTypeName, summary, description?, parent?, assignee_account_id?, additional_fields?: {labels, priority, components}}`, `editJiraIssue {issueIdOrKey, fields: {summary?, description?, labels?}}` |
| Confluence `read` or `write` | `searchConfluenceUsingCql {cql, limit?, cursor?}`, `getConfluencePage {pageId}`, `getConfluenceSpaces {keys?, limit?, cursor?}`, `getPagesInConfluenceSpace {spaceId, limit?, cursor?, title?, sort?}` |
| Confluence `write` | `createConfluencePage {spaceId (its id or key), title, body, parentId?, contentFormat?}`, `updateConfluencePage {pageId, title?, body, version?, contentFormat?}` |

Nothing deletes or archives, in Jira or Confluence: there is no such tool. Arguments of the remote MCP's that would do
something not offered are refused by name (updating a comment with `commentId`, a transition's `fields`, a create's
`transition`, moving a page with `spaceId` or `parentId`); others that change nothing here (`actionSource`,
`responseContentFormat`) are dropped. Bodies are Markdown by default (Jira: or `adf`; Confluence pages: HTML as the
storage format by default, as the remote MCP's, or `markdown`, or `adf`); Markdown becomes ADF on the way in.

- **Offered.** A message turn whose profile (the one it runs on: the chat's own, else the agent's) has an Atlassian part
  with a sign-in gets the tools its rights give, on a runner that says `caps.serverTools`: Jira's read tools while Jira is
  `read` or `changes` and its change tools only with `changes`; Confluence's read tools while it is `read` or `write` and
  its write tools only with `write`; a product that is `off`, or with no project or space chosen, gives none. One with no
  part, no sign-in or an older runner gets none. The turn's standing instructions get one line after them:

  ```
  Atlassian tools (from Most Wanted): on airia.atlassian.net as Ihor Herasko, Jira: read issues in AP; Confluence: off. Your tools, by the names of Atlassian's remote MCP: searchJiraIssuesUsingJql, getJiraIssue, getTransitionsForJiraIssue, getVisibleJiraProjects, lookupJiraAccountId; cloudId is not needed; they never delete or archive.
  ```
- **Checked on every call** (the integrations module, `modules/integrations/`), whatever the runner relayed: the tool is
  one of them; the turn's profile is read again (a change since the turn began counts) and its rights give the tool
  ("Jira changes are off for this agent's profile: it may only read.", "Confluence is off for this agent's profile.",
  "This agent's profile reaches no Jira project."); it has a sign-in; no refused argument; the input passes its schema
  (each issue said, as the agents' tools do).
- **The allowlists.** A search's JQL is ANDed with `project in ("AP", …)` and a CQL's with `space in ("ENG", …)` when the
  scope is not `all`, its `ORDER BY` kept last; the query is read first so it cannot reach past its group (a quote that
  never ends, a parenthesis it never opened or never closes is refused: `a) OR (b` would otherwise escape), and results
  outside the scope are dropped as well. An issue's project is read before it is answered, commented on, transitioned or
  edited; a create's `projectKey` must be one of them; a page's space (by key, read from its space id) before it is read
  or updated; a new page's space (its id or key) before it is created; a space's before its pages are listed; the spaces
  list asks only for the profile's keys. A refusal names the scope: "X-9 is in project X, outside the Jira projects this
  agent's profile reaches (AP)."
- **Pages' versions.** `updateConfluencePage` writes the page's next version. With `version` (the one the agent read, or
  that plus one) a page that changed since is refused ("Page 5001 is at version 4 now, not 2: it changed since you read
  it."); without, the current one is written over. The title stays unless a new one is given.
- **Answers** are JSON trimmed to what an agent needs: an issue's key, address, summary, status, type, priority, assignee,
  reporter, dates, labels, components, description as Markdown (from its ADF), parent, sub-tasks, links and its latest 10
  comments ("the latest 10 of 12"); a page's title, space, version, address and body as Markdown. Empty fields are left
  out, a description or body is cut at 20 000 characters (a search's at 500), a comment at 2 000, another field Jira gave
  at 1 000, the whole answer at 48 000, each with a note of what was left out.
- **Records.** Each call opens the sign-in for `tool:<name>` (a `credential_uses` row with the company, the agent, the
  chat and who sent the turn's prompt; `credentialsForTools` of the credentials module). Each change is audited in the
  company as the agent with the turn as its request (`actor_kind` `agent`, action `tool:<name>`, entity `jira_issue` by
  key or `confluence_page` by id: the comment's id and start, the transition, the new issue's project, type and summary,
  the fields edited, the page's space, title and version), and shows in the turn as its tool call.
- **Atlassian's refusals** in words (the connector, `connectors/atlassian`, Jira v3 and Confluence v2 with basic auth
  through the server's provider client): 401 says to sign in again and marks the sign-in `needs_sign_in`, as its check
  would (by the system); 403 "no permission", 404 "found nothing there, or the account cannot see it", 400 and 422 with
  Atlassian's own words (a JQL's mistake), 409 changed meanwhile; a 429 is retried twice after its `Retry-After` (at
  most 5 s each), then "limiting requests"; no answer in 15 s, a 5xx or a network failure "did not answer". Redirects
  are refused, and only a site on `atlassian.net` is ever called.

### How to test it (Ihor)

1. Merge, then `pnpm --filter @mwc/runner build` and restart the dev API (`pnpm dev`). No migration.
2. **Machines** → the Docker runner's card shows **Runner out of date**: **Update runner** (it rebuilds the container
   from the sources; the runner now says `caps.serverTools`). The new runner is needed once; later server tools need none.
3. **Profiles** → the profile TEST DEV uses: **Add Atlassian** (or keep its part), **Sign-in** your Atlassian sign-in,
   **Jira** Read (all projects, or `AP`), **Confluence** Off or Read.
4. **Agents** → TEST DEV (Claude Code on the Docker runner, home `/work/test-dev`) → its chat. Ask: "what are my last 5
   Jira tickets?". It calls `searchJiraIssuesUsingJql` (as `assignee = currentUser() ORDER BY updated DESC`, kept to the
   profile's projects) and answers with five keys and summaries.
5. Ask: "read AP-301". It calls `getJiraIssue` and answers with its status, description and latest comments; with
   `AP` outside the profile's projects it says the issue is outside them.

## GitHub tools

Built in S7.1d (2026-11-13; before it, TEST DEV, asked about Ihor's pull requests in `airia-platform`, had no GitHub tool
and no `gh`, and Auto mode rightly refused its search of git's configuration for credentials). An agent whose turn runs
on a profile with a GitHub part reads GitHub and, by its rights, opens and updates pull requests through tools the
**server** answers, with the sign-in's token opened on the server for each call; and when the part may push, git and gh
on the agent's machine get the sign-in for that one turn ("git and gh in a turn" below). Ihor's own Claude Code reaches
GitHub through GitHub's MCP server, so the tools keep its names and inputs as its README listed them on 2026-11-13. That
server reads one pull request or issue with one tool and a `method` (`pull_request_read`, `issue_read`): what older
copies called `get_pull_request`, `get_pull_request_diff`, `get_pull_request_files`, `get_pull_request_reviews`,
`get_pull_request_comments` and `get_issue` are its methods `get`, `get_diff`, `get_files`, `get_reviews`,
`get_comments` (and `get_review_comments`) and `issue_read`'s `get`. They reach the turn through the runner's MCP bridge
as the server's own tools (docs/harness.md, "Server tools"), for Claude Code and Codex alike.

| Rights | Tools |
| --- | --- |
| a sign-in and at least one repository (`repos` `all` or a list) | `search_pull_requests {query, owner?, repo?, sort?, order?, page?, perPage?}`, `list_pull_requests {owner, repo, state?, head?, base?, sort?, direction?, page?, perPage?}`, `pull_request_read {method, owner, repo, pullNumber, page?, perPage?}` (`get`, `get_diff`, `get_status`, `get_files`, `get_commits`, `get_review_comments`, `get_reviews`, `get_comments`, `get_check_runs`), `search_issues {query, owner?, repo?, sort?, order?, page?, perPage?}`, `issue_read {method, owner, repo, issue_number, page?, perPage?}` (`get`, `get_comments`, `get_sub_issues`, `get_labels`), `list_commits {owner, repo, sha?, author?, path?, since?, until?, page?, perPage?}`, `get_commit {owner, repo, sha, detail?, page?, perPage?}`, `get_file_contents {owner, repo, path?, ref?, sha?}`, `list_branches {owner, repo, page?, perPage?}`, `search_repositories {query, sort?, order?, page?, perPage?}` |
| `pullRequests` | `create_pull_request {owner, repo, title, head, base, body?, draft?, maintainer_can_modify?}`, `update_pull_request {owner, repo, pullNumber, title?, body?, base?, draft?}` (draft through GitHub's GraphQL, as REST cannot), `add_issue_comment {owner, repo, issue_number, body}` (on a pull request only), `request_copilot_review {owner, repo, pullNumber}` |
| `push` | no tool: git and gh on the machine get the sign-in in the turn ("git and gh in a turn" below) |

Nothing merges, closes or deletes anything: there is no such tool (no `merge_pull_request`, no `delete_*`). Arguments of
GitHub's MCP server that would do something not offered are refused by name: `update_pull_request`'s `state` (closing),
`reviewers` and `maintainer_can_modify`, `create_pull_request`'s `reviewers`, `add_issue_comment`'s `comment_id` and
`reaction`; others that change nothing here (`fields`, `after`, `minimal_output`) are taken and ignored.

- **Offered.** A message turn whose profile (the chat's own, else the agent's) has a GitHub part with a sign-in that
  reaches a repository gets the read tools, and the pull request tools with `pullRequests`, on a runner that says
  `caps.serverTools`; with an Atlassian part too, Atlassian's come first (15 and 14: the 32 a turn's spec carries hold
  both). The turn's standing instructions get one line after them (after Atlassian's), ending with what git and gh get:

  ```
  GitHub tools (from Most Wanted): as ihorherasko, in AiriaLLC/*: read, and open and update pull requests. Your tools, by the names of GitHub's MCP server: search_pull_requests, list_pull_requests, pull_request_read, …; owner and repo name the repository; they never merge, close or delete. git and gh on this machine use this sign-in in this turn (GH_TOKEN; git@github.com remotes go over https): push your branches to those repositories, never to a default branch and never with force; the tools above are preferred for reading and for pull requests.
  ```

  Without `push` the end says pushing is off and git and gh get no sign-in from Most Wanted; on a runner without
  `caps.github` that the runner is too old to give git the sign-in (and the chat's notice says "git push"); when the
  sign-in could not be opened, why. A runner without `caps.serverTools` gets the S7.1c "runner too old" line, naming
  "GitHub" (or "Jira, Confluence and GitHub").
- **Checked on every call** (`modules/integrations/service/github/call.ts`), whatever the runner relayed: the tool is one
  of them; the turn's profile is read again and its rights give the tool ("Pull requests are off for this agent's
  profile: it may only read.", "This agent's profile reaches no GitHub repository."); it has a sign-in; no refused
  argument; the input passes its schema; the repository a tool names (`owner`, `repo`) is in the allowlist ("other/x is
  outside the GitHub repositories this agent's profile reaches (AiriaLLC/*).").
- **The allowlist and searches** (`rules/github/query.ts`). `owner/name` and `owner/*`, case ignored. A search's own
  scope qualifiers (`repo:`, `user:`, `org:`, not negated) and its `owner` and `repo` must each be inside it (an owner
  only when it holds `owner/*`: "Name the repositories with repo: instead."); a search that names none gets the
  allowlist's as qualifiers (`user:AiriaLLC` for `AiriaLLC/*`, `repo:abibas/sandbox` for one; GitHub ORs them), nothing
  with `all`. `search_pull_requests` adds `is:pr` and `search_issues` `is:issue` unless the query says so, and every
  result outside the allowlist is dropped, so a query that slips past the scope still answers nothing outside it. The
  answer shows the query as sent.
- **Answers** are JSON trimmed to what an agent needs (`rules/github/render.ts`): a pull request's number, title, state,
  draft, address, author, head and base, labels, dates, head commit, mergeability, counts and requested reviewers, its
  body cut at 20 000 characters (500 in a list or search); a comment at 2 000, a file's patch at 3 000, a diff and a
  file's text at 40 000; empty fields left out; the whole under the tool result's limit (`rules/answer.ts`, shared with
  Atlassian's).
- **Records.** Each call opens the sign-in for `tool:<name>` and each turn's git sign-in for `tool:git`
  (`credential_uses` rows with the company, the agent, the chat and who sent the turn's prompt). Each change is audited
  in the company as the agent, with the turn as its request: action `tool:<name>`, entity `github_pull_request`
  `owner/repo#n` (a new one's title, head, base, draft and body's start; a change's fields with what they were; a
  comment's id and start; Copilot as reviewer), and shows in the turn as its tool call.
- **GitHub's refusals** in words (the connector, `connectors/github`: `https://api.github.com` with `Authorization:
  Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, through the server's provider
  client with redirects refused): 401 says to sign in again and marks the sign-in `needs_sign_in`, as its check would (by
  the system); 403 "no permission" with GitHub's words; 404 "found nothing there, or the account cannot see it"; 400 and
  422 with GitHub's words (a pull request that already exists); 409 conflict; a redirect "renamed or moved". A rate
  limit (429, or a 403 with `Retry-After` or no requests left until `X-RateLimit-Reset`) is retried twice when its wait
  is at most 5 s, else refused with when to try again ("GitHub is limiting requests. Try again in 3 s."); a 403 that
  says "secondary rate limit" with no header waits a minute, so it is refused at once. No answer in 15 s, a 5xx or a
  network failure: "did not answer".

### git and gh in a turn

When the profile's GitHub part may push (`push`) and reaches a repository, a message turn on a runner that says
`caps.github` gets the sign-in's token in its spec (`TurnSpec.github {token, repos}`, opened for `tool:git`); the runner
puts it in that turn's process environment only, with git's settings, so `git push` (also to an existing
`git@github.com:` remote, rewritten to https) and the agent's habitual `gh pr …` act as the sign-in's account, and a
pre-push hook refuses a push to the default branch, a non-fast-forward, a deletion and a repository outside the
allowlist. The details, and what the hook can and cannot guarantee, are docs/harness.md "git in a turn". With `push`
off no token reaches the machine at all. The server tools stay available either way and are preferred for reading and
for pull requests. The Docker runner's image carries `gh` (2.103.3, pinned and checksum-checked as the sign-in image's);
on other machines gh is the machine's own (the Machines page's Install covers Claude Code and Codex only: gh is no npm
package).

### How to test it (Ihor)

1. Merge, then `pnpm --filter @mwc/runner build` and restart the dev API (`pnpm dev`). No migration.
2. **Machines** → the Docker runner's card → **Update container**: it rebuilds the image from the sources, so the
   container gets the new runner (`caps.github`) and gh. Another machine's runner: **Update runner** (gh is its own).
3. **Profiles** → "Claude Code 2nd" (TEST DEV's): its GitHub part with your GitHub sign-in, **Repositories** `AiriaLLC/*`
   and the sandbox repository you choose (`owner/name`), **Push branches** and **Pull requests** on.
4. **Agents** → TEST DEV → its chat: "what's my latest PR in AiriaLLC/airia-platform?". It calls `search_pull_requests`
   (`author:@me repo:AiriaLLC/airia-platform is:pr`, sorted by updated) or `list_pull_requests`, and answers with the
   number, title, state and address. The tool rows in the thread show the calls.
5. Then: "in /work/test-dev, clone <sandbox> into scratch, make a branch test-push-1 with an empty commit, push it, and
   list the sandbox's pull requests with gh". The clone and push work over https with your sign-in (an SSH address
   too); `gh pr list` answers. Asking it to push to main, or to force-push, ends in the hook's
   "Most Wanted: refused: …" line.

## Slack

Built in S7.1e (2026-11-13; Ihor: "lets do 7.1e... I have keys for slack… now! i need something where i can define
scopes.. READ only etc"). He has a Slack app with a Bot User OAuth Token (`xoxb-`) and a User OAuth Token (`xoxp-`). An
agent whose turn runs on a profile with a Slack part reads Slack and, by its rights, posts, reacts and searches through
tools the **server** answers; the token is opened on the server for each call and never reaches the machine.

### The sign-in

- **One form** (Subscriptions → Tools → Add a tool → Slack, **Bot or user token**): `POST /api/me/subscriptions/tools`
  with `{ kind: 'slack', label?, token }`. The prefix decides the kind: `xoxb-` is `slack_bot_token`, `xoxp-`
  `slack_user_token` (`slackKindOf` of `@mwc/shared/credentials`); anything else (an app-level `xapp-` token, a legacy
  token, spaces, other characters) is a 400 before Slack is asked. A renewal (`credentialId`) keeps its kind: a user token
  for a bot's sign-in is 422 `tool_kind_mismatch`.
- **The check:** `POST https://slack.com/api/auth.test` with the token as the bearer. Slack answers 200 with `{ok: true}`
  and the workspace (`team`, `team_id`, `url`), who the token is (`user`, `user_id`) and a bot's id (`bot_id`); the scopes
  Slack granted come in the `X-OAuth-Scopes` header. All of it is kept in the account details (`team`, `teamId`, `url`,
  `user`, `userId`, `botId`, `enterpriseId`, `scopes`), named "Slack · <workspace>" unless a name is given. A bot token
  that names no bot (or a user token that names one) is refused. Slack refuses with 200 and `{ok: false, error}`:
  `invalid_auth`, `not_authed`, `account_inactive`, `token_revoked` and `token_expired` mean `needs_sign_in` (422
  `tool_sign_in_refused` when adding); `ratelimited` or a 429 `rate_limited`; `internal_error`, `fatal_error`,
  `service_unavailable` or a 5xx `provider_unavailable`; `not_allowed_token_type` and `no_permission` `refused`; anything
  else `invalid_response`.
- **As the other tool sign-ins:** write-only, Check again, the daily check (a revoked or invalid token turns
  `needs_sign_in`, one that works again `active`, new scopes are kept), every check a `tool_check` use.
- **The card** shows the Slack mark, "Slack bot" or "Slack user", the workspace, "Bot · <name>" or "User · <name>", and
  the token's scopes as chips.

### The profile's Slack part

`access_profiles.slack_credential_id` and `slack_rights` (migration `0036_slack_part`, `PROFILE_TOOL_COLUMNS.slack`;
`SlackRights` of `@mwc/shared/credentials`): a Slack sign-in and these rights.

| Right      | What it allows                                                                  | Default |
| ---------- | ------------------------------------------------------------------------------- | ------- |
| `read`     | channels' history and threads, the channel list, the users                      | on      |
| `post`     | post into channels and threads                                                  | off     |
| `channels` | where `read`, `post` and `react` reach: `all`, or names and ids (at most 100)   | `all`   |
| `dms`      | `off`, `read` or `post`: direct messages and group DMs, apart from `channels`   | `off`   |
| `search`   | search messages (a user token's `search:read`, with `read`)                     | off     |
| `react`    | add reactions                                                                   | off     |

**The token's own scopes cap the rights** (`effectiveSlackRights`): a right whose scopes the token lacks gives no tool,
and its call is refused naming the scope ("The Slack sign-in of this agent's profile needs chat:write for
slack_post_message: its owner adds it to the Slack app, reinstalls the app and adds the new token."). A request that
**turns on** a right the part's sign-in cannot use is 422 `slack_scope_missing` ("Post needs chat:write, which this
Slack sign-in lacks: add the scope to the Slack app, reinstall it and add the new token"); a right already on, a new
part's defaults, or a new sign-in alone are never refused, so a part can always be changed and a right turned off. The
Profiles page shows such a right disabled, with a tooltip naming what is missing.

**A user token posts as Ihor himself.** It is allowed, since he has one, but the bot is the default; the part's section
says **Posts as you** beside its sign-in.

### The Slack app's scopes

Give the app the scopes of the rights you mean to use, as **Bot Token Scopes** for the bot (or **User Token Scopes** for
a user token), on its **OAuth & Permissions** page (`SLACK_SCOPES` of `@mwc/shared/credentials`):

| Right                 | Scopes                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------ |
| read                  | `channels:read` and `channels:history`; `groups:read` and `groups:history` for private channels; `users:read` for the users and the authors' names |
| post                  | `chat:write`; `chat:write.customize` to post under the agent's name and icon; `chat:write.public` to post in a public channel the bot was not invited to |
| DMs                   | read: `im:read` and `im:history`; post: also `im:write` and `chat:write`                    |
| search                | a user token's `search:read` (Slack does not let bots search)                              |
| react                 | `reactions:write`                                                                          |

- **Reinstall the app after changing its scopes:** Slack keeps a token's scopes as they were when the app was
  installed. Reinstall it (OAuth & Permissions → Reinstall to Workspace), then **Sign in again** on the card with the
  token Slack shows (or **Check again**, if the token stayed the same) so the new scopes are kept.
- **Don't opt into token rotation** (expiring tokens with a refresh token): it is not supported yet; a rotated token
  stops working after 12 hours and the sign-in turns `needs_sign_in`.
- A bot reads and posts only in channels it was invited to (`/invite @<bot>`); a call there says so ("The bot is not in
  #general: invite the bot to #general in Slack (/invite @mw-bot), then try again.").

### The Slack tools

By the names and inputs of the reference Slack MCP server (`modelcontextprotocol/servers`, whose `slack_<verb>_<thing>`
names Slack's own MCP server shares), with `slack_search_messages` for search:

| Given by                       | Tools |
| ------------------------------ | ----- |
| `read` (or `dms` for DMs)      | `slack_list_channels {limit?, cursor?}`, `slack_get_channel_history {channel_id, limit?, cursor?, oldest?, latest?}`, `slack_get_thread_replies {channel_id, thread_ts, limit?, cursor?}` |
| the same with `users:read`     | `slack_get_users {limit?, cursor?}`, `slack_get_user_profile {user_id}` |
| `post` (or `dms` `post`)       | `slack_post_message {channel_id, text}`, `slack_reply_to_thread {channel_id, thread_ts, text}` |
| `react`                        | `slack_add_reaction {channel_id, timestamp, reaction}` (the emoji's name, colons dropped) |
| `search`                       | `slack_search_messages {query, count?, page?, sort?, sort_dir?}` |

Nothing deletes, edits a message, invites, kicks or administers: there is no such tool. Arguments that would change who
a post shows as or how far it reaches (`username`, `icon_emoji`, `icon_url`, `as_user`, `blocks`, `attachments`,
`link_names`, `parse`, `reply_broadcast`) are refused by name.

- **Offered** to a message turn whose profile (the chat's own, else the agent's) has a Slack part with a sign-in, on a
  runner that says `caps.serverTools`, by its rights as its token's scopes let them work. The standing instructions get
  one line: "Slack tools (from Most Wanted): as mw-bot in Airia: read #general; post in #general. Your tools, by the
  names of the Slack MCP servers: …; channel_id takes a channel's id or #name. Posts show under your own name on the bot;
  @here, @channel and @everyone are stripped. They never delete, edit others' messages, invite or kick." The briefing's line: "- Slack: as mw-bot in Airia; may read #general; may post in
  #general. Your Most Wanted tools: slack_get_channel_history, slack_post_message, …; never @here, @channel or @everyone."
- **Checked on every call** (`modules/integrations/service/slack/call.ts`): the tool is one of them; the profile is read
  again; the part has a sign-in and its working rights give the tool; no refused argument; the input passes its schema.
- **The conversation** a call names (`channel_id`) is resolved and checked before Slack is asked to act
  (`service/slack/channels.ts`): a name (`#general` or `general`) is found in the channels the sign-in sees
  (`conversations.list`, public ones and, with `groups:read`, private ones, up to 1000); an id the allowlist names is
  used as it is, any other id read with `conversations.info`; then the channel must be in `channels` (by its id or its
  name) and the right on: "#random is outside the Slack channels this agent's profile reaches (#general).". A DM's id
  (`D…`) and a group DM go by `dms` alone ("Direct messages are off for this agent's profile.", "This agent's profile may
  only read direct messages."); a person's id (`U…`) only posts a DM, opened with `conversations.open`.
  `slack_list_channels` gives a page of what the sign-in sees, kept to the allowlist (and the DMs when they are on),
  saying how many it left out. A search's hits outside the channels and DMs are dropped and counted.
- **Posting** (`service/slack/posts.ts`): every mention of many people is stripped before Slack sees the text
  (`<!here>`, `<!channel>`, `<!everyone>`, user groups `<!subteam^…>`, and `@here`, `@channel`, `@everyone` typed as
  words; the word stays, the mention goes; the answer and the audit row name what was stripped), with `link_names` off,
  `parse` none and no unfurls. The text goes as it is, as the post's plain `text`, with no blocks and no footer. On a
  bot token with `chat:write.customize` the post shows under the agent's name, and its icon when the agent's icon is an
  emoji Slack knows by name (`:robot_face:` for 🤖, about forty common ones); agents' uploaded images have no public
  address yet, so none is sent as `icon_url`. Without that scope it shows as the bot; a user token's as its person.
- **Answers** are trimmed JSON (`rules/slack/render.ts`): a message's `ts`, its time, its author by name (from
  `users.info` with `users:read`, at most 15 a call, else the id), text (cut at 4000), thread and replies, reactions and
  files; a channel's id, `#name`, topic and members; a person's names and title; a hit's channel, text and link.
- **Slack's refusals** in words (the connector, `connectors/slack`: `POST https://slack.com/api/<method>`, form-encoded,
  `Authorization: Bearer`, redirects refused, 15 s an attempt): `invalid_auth`, `token_revoked` and the like say to add
  the token again and mark the sign-in `needs_sign_in`; `missing_scope` names the scope and says to reinstall the app;
  `not_in_channel` says to invite the bot; `channel_not_found` and the like "found nothing there"; anything else with
  Slack's own error ("Slack said: already_reacted."). A rate limit (429 with `Retry-After`, or `error: ratelimited`) is
  retried twice when its wait is at most 5 s, else refused with when to try again.
- **Records.** Each call opens the sign-in for `tool:<name>` (a `credential_uses` row with the company, the agent, the
  chat and who sent the prompt). Each post and reaction is audited in the company as the agent, with the turn as its
  request: action `tool:<name>`, entity `slack_message` `<channel id>/<ts>`, fields `channel`, `thread`, `text` (its
  start), `mentionsStripped`, `reaction`.
- **How many tools.** Slack's 9 with GitHub's 14 and Atlassian's 15 pass the 32 a turn's spec carried; a turn now
  carries up to 64, and an older runner still gets 32 with the least important left out (docs/harness.md, "Server tools").

**Later** (Ihor, 2026-11-13): Slack may help mirror the team structure, a channel per team for example. Not built.

### How to test it (Ihor)

1. Merge, then `pnpm --filter @mwc/runner build` and restart the dev API (`pnpm dev`): migration `0036_slack_part` runs
   on start. On **Machines**, the Docker runner's card → **Update container** (another machine's runner: **Update
   runner**). The Slack tools work on an older runner too; the update only lets a turn carry more than 32 tools.
2. In the Slack app (api.slack.com/apps → your app → OAuth & Permissions), check the Bot Token Scopes: `channels:read`,
   `channels:history`, `users:read`, `chat:write`, `chat:write.customize` (and `groups:read`, `groups:history` for a
   private channel). After a change, **Reinstall to Workspace**. In Slack, invite the bot to the test channel
   (`/invite @<bot>`).
3. **Subscriptions** → **Tools** → **Add a tool** → **Slack** → **Bot or user token**: paste the Bot User OAuth Token
   (`xoxb-…`). The card shows the workspace, "Bot · <name>" and the scopes.
4. **Profiles** → TEST DEV's profile → **Add Slack**: its sign-in is the bot; **Channels**: switch off **All channels**,
   type the channel's name and Enter; **Read** on, **Post** off.
5. **Agents** → TEST DEV → its chat: "what's new in #<channel>?". It calls `slack_get_channel_history` and answers with
   the latest messages by their authors. Asking about another channel ends in "… is outside the Slack channels this
   agent's profile reaches".
6. Back on **Profiles**, switch **Post** on. In the chat: "post a test message in #<channel>". It calls
   `slack_post_message`; the message shows under TEST DEV's name, with no footer.

## Security

- **At rest:** AES-256-GCM per secret, with the AAD binding it to its id, owner and kind, and a key version so the
  master key can rotate. The master key is `MWC_MASTER_KEY` in production (a cloud key service later) and a generated
  `.data/master.key` (0600, git-ignored) in development; tests use a key in memory (S3.1). It is never logged or
  printed.
- **Write-only:** the API returns metadata (kind, label, account email, plan, status, last checked, a gateway's header
  names and previews), never the secret, not even to its owner. Adding, renaming, removing and assigning need the owner's Clerk session; API keys are refused.
- **On machines:** nothing at rest. How a run receives its credential is decided in S5, starting with a short test of a
  relay: the run would get a short-lived run token and the server would swap in the real credential, so SSH into a
  container or a box finds nothing reusable. The fallback hands the credential to the run's environment over the
  runner's connection, never to disk, where root on that machine could read it while the run lives. Chats (S5.1b, Ihor's choice
  of 2026-11-09) use the fallback: each turn's credential goes in its `turn.start` over the runner's link, refreshed by
  the server first; on disk only while its process runs: Codex's `auth.json`, and Claude Code's settings file with the
  gateway's headers (0600, in a 0700 folder of the runner's; docs/harness.md, "How a turn runs").
- **Audit:** every add, change, removal and assignment, and every server-side use of a secret (a usage check, a tool
  sign-in's check, a run, a gateway's previews made or headers edited), with who or what used it. The uses are `credential_uses` rows, kept, like the audit rows, after a
  subscription is removed (S3.1).

## The limits widget

"Subscription limits" on the home page, with **Manage** and **Add a subscription**. One card per subscription of the
signed-in person: its name and account email; for subscriptions, the 5-hour and weekly bars with the percentage and
the reset time (per-model weekly windows when the provider gives them); amber from 80%, red when reached; the
provider's refusals in plain words ("The provider rate limited the usage check. Try again later."), keeping the last
good values. Limits are checked when the page opens and again every 3 minutes while it is visible (15 for the
one-token probe, which spends a little of the subscription), and about 30 seconds after a window resets; a window whose
reset has passed shows "updating…" over a dimmed bar, never its old share.

### The limits API (S3.3)

`GET /api/me/subscriptions/limits` is a personal route (a signed-in session only; an API key is 403
`session_required`). It answers `{ limits: [...] }`, one entry per subscription of the caller, oldest first:

```
{ credentialId, kind, label, accountEmail, source: 'usage_api' | 'message_headers' | 'none', checkedAt,
  windows: [{ id: 'five_hour' | 'seven_day' | 'weekly', or one model's window: 'seven_day_fable', 'seven_day_opus', …
              (the pattern ^(five_hour|seven_day|weekly)(_[a-z0-9]+)?$),
              label, usedPercent (0–100, two decimals), resetsAt (ISO, or null when the provider gives none), reached }],
  error: { code, message } | null, stale }
```

| Kind                 | Check                                                                                         | Token refresh |
| -------------------- | --------------------------------------------------------------------------------------------- | ------------- |
| `claude_oauth`       | `GET https://api.anthropic.com/api/oauth/usage`, `Authorization: Bearer <access token>`, `anthropic-beta: oauth-2025-04-20`; every top-level `five_hour`, `seven_day` and `<that>_<model>` key with a `utilization` (percent) and `resets_at`, so new models (`seven_day_fable`) show unchanged; labels "Weekly · Fable" | Claude Code's own refresh: `POST https://platform.claude.com/v1/oauth/token`, JSON `grant_type=refresh_token`, the refresh token, Claude Code's client id and the login's scopes; `expires_in` becomes `expiresAt` |
| `claude_setup_token` | `POST https://api.anthropic.com/v1/messages`, `max_tokens: 1` of `claude-haiku-5-5`, the same bearer and beta header, `anthropic-version: 2023-06-01`; only the headers are read: `anthropic-ratelimit-unified-<5h\|7d>[_<model>]-utilization` (a fraction; `7d_fable` is `seven_day_fable`), `-reset` (epoch seconds), `-status` (`rejected` is reached), on a 429 too | none (one year) |
| `codex_oauth`        | `GET https://chatgpt.com/backend-api/wham/usage`, the bearer and `ChatGPT-Account-Id`; `rate_limit.primary_window` and `secondary_window` mapped by `limit_window_seconds` (a day or less is `five_hour`, longer `weekly`) | v1's: `POST https://auth.openai.com/oauth/token`, JSON with Codex's client id and `scope: openid profile email`; `last_refresh` now, `account_id` kept |
| keys and gateways    | none: `source: 'none'`, no secret opened                                                       | — |

- **When:** a login's access token is refreshed when it expires within 5 minutes (Claude's `expiresAt`, the `exp` of
  OpenAI's JWT), and once after a 401. The new token set is sealed again in place of the old one
  (`replaceCredentialSecret`, an audit row `replace_secret` that names the key version and the purpose, never the
  secret). A second 401, a refresh the provider refuses (4xx) or a login without tokens sets the subscription to
  `needs_sign_in` (audited, the system acting); a later good check sets it back to `active`. A refresh that is rate
  limited or down is only a failed check.
- **Cache and floors:** each subscription's last check (its time, its refusal, the last good windows) is kept in the
  server's memory behind the `UsageCache` port. Every request (the page asks every 3 minutes while visible) checks a
  subscription never checked, one whose last check is at least 3 minutes old (15 for the probe), and at once one whose
  window reset since its last check; `?refresh=1` forces a check. None is checked within a minute of its last check,
  nor before a provider's 429 wait is over: its `Retry-After` (at most an hour), else 3, 6, 12, then 15 minutes, the
  last good windows staying `stale` meanwhile. One check runs per subscription at a time; concurrent requests share it.
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

Runs and the relay (S5); GitHub and Jira sign-ins (S7, built in S7.1a: "Tool sign-ins" above); company-owned subscriptions; sharing a personal subscription
with other people (it stays its owner's, within the provider's terms).

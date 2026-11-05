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
  `.data/master.key` (0600, git-ignored) in development. It is never logged or printed.
- **Write-only:** the API returns metadata (kind, label, account email, plan, status, last checked), never the secret,
  not even to its owner. Adding, renaming, removing and assigning need the owner's Clerk session; API keys are refused.
- **On machines:** nothing at rest. How a run receives its credential is decided in S5, starting with a short test of a
  relay: the run would get a short-lived run token and the server would swap in the real credential, so SSH into a
  container or a box finds nothing reusable. The fallback hands the credential to the run's environment over the
  runner's connection, never to disk, where root on that machine could read it while the run lives.
- **Audit:** every add, change, removal and assignment, and every server-side use of a secret (a usage check, later a
  run), with who or what used it.

## The limits widget

"Subscription limits" on the home page, with **Manage** and **Add a subscription**. One card per subscription of the
signed-in person: its name and account email; for subscriptions, the 5-hour and weekly bars with the percentage and
the reset time (per-model weekly windows when the provider gives them); amber from 80%, red when reached; the
provider's refusals in plain words ("The provider rate limited the usage check. Try again later."), keeping the last
good values. Limits are checked when the page opens, at most every 5 minutes per subscription (15 for the one-token
probe, which spends a little of the subscription).

## Out of scope for S3

Runs and the relay (S5); GitHub and Jira sign-ins (S7); company-owned subscriptions; sharing a personal subscription
with other people (it stays its owner's, within the provider's terms).

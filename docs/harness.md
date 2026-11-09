# Harness drivers

How a runner turns one chat turn into a harness process and its output into events (S5.1a, 2026-11-09). The drivers
are pure: they build process specs and parse lines, and never spawn anything. The runner loads them (never the server):
it gets a turn with its credential over its link, asks the driver for the process spec, starts it in the agent's home
folder, feeds stdout to the driver's parser line by line and sends the events to the server. S5.1b runs them: chats with
an agent on its machine, each prompt one turn ("How a turn runs" below), and the chat's terminal on the same
conversation.

| Package                       | What                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `@mwc/shared/harness`         | the wire contracts (zod): `TurnSpec`, `TerminalSpec`, `HarnessCredential`, `HarnessGateway`, `TurnEvent`, the limits |
| `@mwc/harness-core`           | the port: `HarnessDriver`, `ProcessSpec`, `PrivateDir`, `LineParser`, `HarnessError`, the shared checks and text helpers |
| `@mwc/harness-core/fake`      | `FakeHarnessDriver`, the fake binary (`FAKE_HARNESS_BIN`, `runFakeHarness`), fake specs and credentials |
| `@mwc/harness-claude-code`    | `ClaudeCodeDriver` (`claude`), its parser; `/fixtures`: five recorded-style turns              |
| `@mwc/harness-codex`          | `CodexDriver` (`codex`), its parser; `/fixtures`: five recorded-style turns                   |

The server reads only `@mwc/shared/harness`; it never imports a harness package.

## The port

```ts
TurnSpec     { harness, cwd, prompt, sessionId: string|null, model: string|null, effort?, permissionPolicy: 'ask'|'bypass',
               configDir: string|null, credential: HarnessCredential, gateway: { baseUrl, headers } | null }
TerminalSpec  the same without `prompt`

ProcessSpec  { command, args, env /* to add or override */, unsetEnv /* to remove */, stdin: string|null,
               privateDir?: { env, path: string|null, files: { name, contents, mode }[] }, notices: TurnEvent<'notice'>[] }

HarnessDriver { harness; versionArgs; turn(TurnSpec): ProcessSpec; terminal(TerminalSpec): ProcessSpec; parser(): LineParser }
LineParser    { feed(line): TurnEvent[]; end(exitCode: number|null, stderrTail: string): TurnEvent[] }
```

- **Starting it.** The runner starts `command` with `args` (no shell) in `cwd`, from its own environment minus `MWC_*`
  and minus `unsetEnv`, plus `env`. It writes `stdin` (the prompt) and closes it; a terminal gets the pseudo-terminal
  instead (`stdin` is null). It sends `notices` as the turn's first events (a terminal shows them above the TUI).
- **The prompt is never an argument.** It goes on stdin: an argument would show in `ps` to every user of the machine,
  hit the argument length limit, and a one-word message such as `update`, `install` or `purge` would run that
  subcommand of `claude` (Commander dispatches on the first operand, even after `--`), `review` that of `codex exec`.
- **`privateDir`** (Codex): the folder a harness keeps its state in. The runner makes it private (0700) when missing,
  sets `env` to its path, writes `files` before the start and removes them when the last process using the folder
  exits, so the login is on disk only while a process runs. The folder is kept: Codex records its threads there, so a
  resume needs the same folder. `path` is the turn's `configDir`, or null for the runner's own private folder for this
  harness and `cwd`. A file of that name already there that the runner did not write must be set aside and put back,
  never overwritten (the runner's step).
- **Errors.** `turn` and `terminal` throw only `HarnessError`: `credential_mismatch` (a credential of the other
  harness's family) or `invalid_spec` (another harness's turn, an empty prompt, a session id or model that is not one
  word, which would be read as an option, a gateway header on two lines). The wire schemas hold the same rules; the
  drivers check again because what they build goes to a process.
- **Parsing.** One parser per process, never throwing: a blank, partial or garbled line and an unknown type give
  nothing. `end` gives a failing `result` when the output gave none: how the process ended (`exited with code 1`,
  `was stopped before it finished the turn`, `ended without finishing the turn`) and the first detail that says
  something (the harness's own last error, the end of stderr, the last stray line), cut to fit.

## Events

| `type`        | Fields                                                    | Notes                                                       |
| ------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `session`     | `sessionId`                                               | the conversation to resume next time (Claude's session, Codex's thread) |
| `text`        | `text`                                                    | the assistant's text, as it comes                           |
| `tool`        | `id`, `name`, `summary` (one line, ≤ 200)                 | the input in one line: the command, file, pattern, address  |
| `tool_result` | `id`, `ok`, `summary` (≤ 500)                             | the start of the result (Claude), the exit code and the end of the output (Codex commands) |
| `usage`       | `inputTokens`, `outputTokens`, `cachedInputTokens?`, `costUsd?` | input counts cached tokens too; Claude adds its cache writes and reads |
| `notice`      | `level` (`info`, `warn`), `message` (≤ 2000)              | a tool refused for permission, a retried request, a gateway not used |
| `result`      | `ok`, `text?` (the reply), `error?` (≤ 2000), `durationMs?` | always the last event of a turn                             |

A runner sends them as `turn.events`, each with its `seq` from 1 (docs/runner-protocol.md, "Chat turns").

## Credentials

| Credential           | Claude Code                             | Codex                                                                  |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `claude_oauth`       | `CLAUDE_CODE_OAUTH_TOKEN` (the access token) | `credential_mismatch`                                             |
| `claude_setup_token` | `CLAUDE_CODE_OAUTH_TOKEN`               | `credential_mismatch`                                                  |
| `anthropic_api_key`  | `ANTHROPIC_API_KEY`                     | `credential_mismatch`                                                  |
| `codex_oauth`        | `credential_mismatch`                   | `auth.json` (the login, 0600) in `CODEX_HOME`                          |
| `openai_api_key`     | `credential_mismatch`                   | turn: `CODEX_API_KEY` (codex exec's documented variable); terminal: `auth.json` holding only `OPENAI_API_KEY` (the TUI reads no key variable) |

Every account variable a turn does not set is in `unsetEnv`, so the access profile alone decides: Claude Code's
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`,
`CLAUDE_CODE_USE_BEDROCK|VERTEX|FOUNDRY`, `CLAUDE_CONFIG_DIR` (an API key left in the machine's environment would win over
the profile's subscription); Codex's `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, `OPENAI_BASE_URL`.

## Claude Code

Verified against `claude --help` 2.1.319.

```
turn:      claude -p --output-format stream-json --verbose [--resume <id>] [--model <m>] [--effort <e>]
                  [--dangerously-skip-permissions]                      prompt on stdin
terminal:  claude [--resume <id>] [--model <m>] [--effort <e>] [--dangerously-skip-permissions]
env:       the credential's variable; CLAUDE_CONFIG_DIR=<configDir> when set; with a gateway
           ANTHROPIC_BASE_URL=<baseUrl> and ANTHROPIC_CUSTOM_HEADERS="Name: value" one per line
```

- **Permissions.** `bypass` adds `--dangerously-skip-permissions`. `ask` adds nothing: in `-p` there is no one to ask,
  so a tool that needs approval is refused, the model is told, and the `result`'s `permission_denials` become `warn`
  notices (`Refused for permission: Bash (rm -rf build)`). In the terminal Claude Code asks the person on the TUI.
- **Parsing** (`stream-json`): the first message with a `session_id` (`system/init`) gives `session`; `assistant`
  text blocks give `text`, `tool_use` and `server_tool_use` give `tool`; `user` `tool_result` blocks give
  `tool_result` (`is_error` → not ok); `system/api_retry` gives an `info` notice; `result` gives the denials' notices,
  `usage` (`usage`, `total_cost_usd`) and `result` (`is_error` or a subtype other than `success` → not ok, with the
  `result` text, the `errors` or the subtype in words; `duration_ms`). Thinking blocks give nothing; a subagent's own
  messages (with a `parent_tool_use_id`) give nothing, since its call is the `Task` tool and its answer that tool's
  result.

## Codex

Verified against `codex --help`, `codex exec --help`, `codex exec resume --help` and `codex resume --help` 0.162.1 (the
sign-in helper pins 0.163.0), and the documented `--json` events (`codex-rs/exec/src/exec_events.rs`).

```
turn, new:      codex exec --json --skip-git-repo-check [--model <m>] [-c model_reasoning_effort="<e>"] <permissions> -
turn, resume:   codex exec resume --json --skip-git-repo-check [--model <m>] [-c …] <permissions> <threadId> -
terminal:       codex [resume] [--model <m>] [-c …] <permissions> [<threadId>]
permissions:    bypass  --dangerously-bypass-approvals-and-sandbox
                ask     turn: -c sandbox_mode="workspace-write" -c approval_policy="never"
                        terminal: --sandbox workspace-write --ask-for-approval on-request
home:           privateDir CODEX_HOME = configDir, or the runner's own folder for this cwd
```

- **Why `-c` for the turn's sandbox.** `codex exec resume` has no `--sandbox`; the config overrides work for both
  forms. With approvals off, what the workspace-write sandbox does not allow fails and the model is told; a command
  Codex reports `declined` gives a `warn` notice.
- **The trailing `-`** makes Codex read the prompt from stdin (after the thread id on a resume).
- **Gateway: not supported yet.** A turn with a gateway runs without it and its spec carries the notice
  `This access profile’s gateway is not used: …`; nothing of the gateway reaches the process. A profile's gateway is
  an Anthropic endpoint today, and refusing would stop every Codex agent on a profile that has one.
- **Parsing** (`--json`): `thread.started` gives `session` (`thread_id`); `item.started` of a command, an MCP call or a
  web search gives `tool` at once; `item.completed` gives `text` (`agent_message`, kept as the reply), `tool` when not
  shown yet and `tool_result` (a command: `exit <code>: <the end of its output>`; a file change: applied or failed; an
  MCP call: its text or its error), a `warn` notice for an `error` item; `turn.completed` gives `usage`; `turn.failed`
  gives a failing `result`; an `error` event gives a `warn` notice (Codex also reports retries it recovers from this
  way) and is the failure's detail when the turn does not complete. Reasoning and the to-do list give nothing. Codex
  has no result event: a clean exit (0) after `turn.completed` gives `result` ok with the last agent message.

## How a turn runs

Built in S5.1b (2026-11-09; Ihor's choices of that day): a chat with an agent runs on the agent's placement (its machine
and home folder), on the agent's access profile unless the chat has its own, with Claude Code or Codex, as a process per
turn (chat mode) or the real TUI (terminal mode). The server is the chats module (`apps/server/src/modules/chats/`); the
runner's side is `apps/runner/src/turns/` and its terminals.

1. **A chat** (`POST /api/companies/{companyId}/agents/{agentId}/chats`, admins and owners) is bound at creation to the
   agent's harness and to its placement's machine: a harness session lives on the machine it began on, so a placement
   moved to another machine later refuses the chat's turns (`machine_changed`, "start a new chat"), as a changed harness
   does (`harness_changed`). A chat may have its own access profile, chosen only by its owner (the rule of giving a
   profile to an agent: `profile_not_yours`, `session_required`); it counts while that person is still an admin or owner
   of the company (else `profile_missing`), and goes when the profile does.
2. **A prompt** (`POST …/chats/{chatId}/turns`, at most 20 000 characters) is checked in this order, each refusal
   naming what to fix: the chat not archived, no turn of it running; the agent's placement (none, `container` mode: S5
   proper), its machine's runner connected, newer than chats (`caps.harnesses` with versions) and with the harness's
   CLI; the profile (the chat's, else the agent's) and the subscription in the harness's slot (Claude Code: the Claude
   slot and the gateway slot; Codex: the OpenAI slot).
3. **The credential** is opened by the credentials module as its owner (`credentialsForHarness`): one
   `credential_uses` row per turn, naming the company, the agent, the chat and who sent the prompt (`chat_turn`;
   `chat_terminal` for a terminal), and one for the gateway. A Claude login whose access token has under 60 minutes left
   is refreshed first (Claude Code's own refresh call, the new token set sealed again); a Codex login whose token is near
   its end the same way as its usage check. A refused refresh marks the login `needs_sign_in`
   (`credential_needs_sign_in`); a provider that does not answer keeps a token that still works, else
   `provider_unavailable` (503). The secret goes with this turn only, in `turn.start` over the runner's link: nothing on
   the machine's disk for Claude (the token is the process's `CLAUDE_CODE_OAUTH_TOKEN`), and Codex's `auth.json` only
   while its process runs. A Codex chat's gateway goes as its address alone (no headers), so the driver says it is not
   used and nothing of its secret leaves the server.
4. **The turn** is recorded `running` (with the profile and credential it runs on; the first prompt is the chat's title,
   80 characters), its sink is put in place, and `turn.start {turnId, spec}` goes to the runner. The answer is 202 with
   the turn.
5. **The runner** (`turns/turns.ts`, `turn.ts`) refuses at once with `turn.end {ok: false, exitCode: null, error}`
   what it cannot run: `unsupported` (no such CLI, even after searching again, or no way to start processes), `busy` (all `slots` live), `home_missing`
   (the agent's folder is not there), `invalid_spec: …` (the driver refused the spec), `spawn_failed: …`,
   `runner_stopping`. Otherwise it starts the driver's command with no shell, detached (its own process group), in the
   agent's folder, with its own environment less `MWC_*` and the driver's `unsetEnv`, plus `env` and the private folder's
   variable; writes the prompt to stdin and closes it; sends the driver's notices as the first events; reads stdout line
   by line into the driver's parser and keeps the last 4 KB of stderr. Events go as `turn.events` about 100 ms after the
   first, or at once from 32 KB or 100 events, numbered from 1; a text event over 16 KB is split, a result's text cut to
   fit. On exit, `parser.end` gives the last events, then `turn.end {ok, exitCode, error?, authJson?}`: `ok` is the
   result's, `error` is `stopped` after `turn.stop` (SIGINT to the group, SIGTERM 5 s later, SIGKILL 10 s after the
   SIGINT) or `runner_stopping`. Live turns hold the machine as live runs do and make the self-update say `busy`.
6. **Codex's private folder** (`turns/private-dir.ts`): the placement's `configDir` when it has one, else
   `<runner state dir>/<harness>/<first 16 hex of sha256(home)>/`, never the machine's `~/.codex`; made 0700. `auth.json`
   is written 0600 before the process (a marker file first; a file of that name the runner did not write is set aside
   and put back) and removed when the last process using the folder ends. When the process rewrote it (its own token
   refresh), the new text goes back in `turn.end.authJson` (a terminal's in `terminal.exit.authJson`) and the server
   seals it into the credential again; the browser never sees it.
7. **The server** stores each event (`chat_events`, a resend kept once), saves the chat's `session_id` from the
   `session` event (the next turn resumes it), tells the chat's stream listeners, and on `turn.end` closes the turn:
   `done`, `failed` (the runner's reason first, else the result's error) or `stopped`, with the result's text and the
   usage. A runner whose link drops fails its running turns (`machine_disconnected`; the runner ends their processes
   too, nothing is re-attached yet), and at the server's start the turns a stopped server left running fail
   (`server_restarted`).
8. **The stream** (`GET …/chats/{chatId}/stream`, members and above): Server-Sent Events over an authenticated GET
   (the web reads it with `fetch` and its Bearer header): `turn` (`{turn}`) on a start and each status change, `event`
   (`{turnId, turnSeq, seq, event, at}`, its `id:` `<turnSeq>.<seq>`), a `: heartbeat` comment every 20 s;
   `Last-Event-ID` replays the turns from that turn on and the events after it, then the live ones, never one twice.
9. **The terminal** (`POST …/chats/{chatId}/terminal-tickets`, owners only): the same checks and credential, then the
   machine terminal's one-time ticket (`/api/terminal/ws`), holding the resolved `TerminalSpec` in the server's memory
   for its 60 s. Opening the socket sends `terminal.open` with `harness`, and the runner starts `driver.terminal(spec)`
   in the PTY (the TUI resuming the chat's session) instead of a login shell, with the same environment rules and
   private folder; the driver's notices are printed above it. A runner without the CLI answers `terminal.exit` with
   `unsupported`.

### Where the runner finds the CLIs

`apps/runner/src/system/find-cli.ts` (2026-11-09, after a devbox whose runner was installed over a non-interactive SSH
command reported no Claude Code while `claude` worked in its login shell): `claude` and `codex` are looked for without
starting a process, on the PATH's absolute folders first, then in the folders their installers use: `~/.local/bin`
(Claude Code's native installer), `~/.claude/local`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`,
`/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin` and the `bin` of the newest Node under `~/.nvm/versions/node` (by
version). Only an executable file counts. The power tools' search (`localDevbox`, docs/machines.md) works the same way
with its own folders.

- At start the runner asks each CLI found `--version` once, by its full path (`caps.harnesses`; Claude Code's is also
  the hello's `claudeVersion`).
- Turns and chat terminals start the CLI by that full path, with its folder first on the child's PATH, so its own
  helpers resolve (the `node` beside an npm-installed `claude` in an nvm `bin`).
- A turn or a chat terminal for a harness that was missing at start searches again first (no process unless it is found
  now, then one `--version`). When found, the turn runs it and the next hello carries its version. There is no frame
  that updates `caps` on a live link, and the server refuses a harness the last hello said is missing
  (`harness_missing`), so a CLI installed later counts once the runner reconnects.
- `install` puts the usual folders that exist on the service's PATH too (docs/machines.md, "Install").

`ask` in chat mode refuses a tool that needs approval (Claude Code's denials and Codex's declined commands become `warn`
notices) until S6 brings the permission round trip; the terminal asks the person on the TUI. No test runs a real
`claude` or `codex` turn: that spends Ihor's subscription.

## Tests

- Each connector's tests run every argument and environment combination and parse its five fixtures (`answer`,
  `tool`, `denied`, `error`, `resume`), written from the documented formats, never recorded from a real turn (that would
  spend a subscription). The runner's tests reuse them from `@mwc/harness-claude-code/fixtures` and
  `@mwc/harness-codex/fixtures`.
- The fake binary, `node FAKE_HARNESS_BIN`, plays a `FakeScenario` JSON file named by `FAKE_HARNESS_SCENARIO`: it reads
  stdin, writes what it got (argv, cwd, stdin, only the variables `recordEnv` names) to `record`, prints `lines` (after
  `delayMs` each), then `stderr`, waits `holdMs` and exits with `exitCode`. A runner test points `FakeHarnessDriver` at it
  (`command: process.execPath, args: [FAKE_HARNESS_BIN], env: { FAKE_HARNESS_SCENARIO }`) with `fakeLines(events)`, or
  replaces a real driver's command with it to play a CLI fixture through the real parser.

## Not supported yet

- The journal, re-attaching a turn after a runner or server restart, and runs of tasks (S5.2 and on): a dropped link ends
  a chat's turn today.
- Codex through a gateway; Claude Code's own `settings.json` `env` can still override the gateway variables of a turn
  (`--settings` with the gateway, from a private file, is the planned fix).
- A Claude login's access token that expires during a turn longer than its remaining hour: the server refreshes it only
  before the turn. Two Codex processes on one private folder at once (a turn and a terminal) share one `auth.json`: the
  later one writes its login over a token the first may have just refreshed (the server seals again what comes back).
- Asking the person mid-turn (the permission tool, `ask_user`): S6. Until then `ask` refuses in chat and asks only in
  the terminal.
- Running as root: Claude Code refuses `--dangerously-skip-permissions` as root, which matters for container runs.

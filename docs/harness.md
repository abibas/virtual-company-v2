# Harness drivers

How a runner turns one chat turn into a harness process and its output into events (S5.1a, 2026-11-09). The drivers
are pure: they build process specs and parse lines, and never spawn anything. The runner loads them (never the server):
it gets a turn with its credential over its link, asks the driver for the process spec, starts it in the agent's home
folder, feeds stdout to the driver's parser line by line and sends the events to the server.

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

A runner sends them as `run.events` with the event's `type` as `kind` and the rest as `data`.

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

- The runner's execution: spawning, the private folder, the journal, Stop (S5.1b and S5.2).
- Codex through a gateway; Claude Code's own `settings.json` `env` can still override the gateway variables of a turn
  (`--settings` with the gateway, from a private file, is the planned fix).
- A Codex login's refreshed `auth.json`: Codex rewrites it when it refreshes its token, and the runner does not send it
  back yet, so the server must hand out a fresh login (its usage check refreshes it); the same for a Claude login's
  access token, which expires during a very long turn.
- Asking the person mid-turn (the permission tool, `ask_user`): S6. Until then `ask` refuses in chat and asks only in
  the terminal.
- Running as root: Claude Code refuses `--dangerously-skip-permissions` as root, which matters for container runs.

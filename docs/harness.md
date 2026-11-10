# Harness drivers

How a runner turns one chat turn into a harness process and its output into events (S5.1a, 2026-11-09). The drivers
are pure: they build process specs and parse lines, and never spawn anything. The runner loads them (never the server):
it gets a turn with its credential over its link, asks the driver for the process spec, starts it in the agent's home
folder, feeds stdout to the driver's parser line by line and sends the events to the server. S5.1b runs them: chats with
an agent on its machine, each prompt one turn ("How a turn runs" below), and the chat's terminal on the same
conversation.

| Package                       | What                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `@mwc/shared/harness`         | the wire contracts (zod): `TurnSpec`, `TerminalSpec`, `HarnessCredential`, `HarnessGateway` (`harness/specs.ts`), `TurnEvent` and its limits (`harness/events.ts`), `contextWindowOf` (`harness/context.ts`), the question tool's input and the answers (`harness/questions.ts`) |
| `@mwc/harness-core`           | the port: `HarnessDriver`, `ProcessSpec`, `PrivateDir`, `TurnTools`, `LineParser`, `HarnessError`, the shared checks and text helpers (`clipMarked` for long texts) |
| `@mwc/harness-core/fake`      | `FakeHarnessDriver`, the fake binary (`FAKE_HARNESS_BIN`, `runFakeHarness`), fake specs and credentials |
| `@mwc/harness-claude-code`    | `ClaudeCodeDriver` (`claude`), its parser; `/fixtures`: seven recorded-style turns             |
| `@mwc/harness-codex`          | `CodexDriver` (`codex`), its parser; `/fixtures`: six recorded-style turns                    |

The server reads only `@mwc/shared/harness`; it never imports a harness package.

## The port

```ts
TurnSpec     { harness, cwd, prompt, sessionId: string|null, model: string|null, effort?, permissionPolicy: 'ask'|'bypass',
               configDir: string|null, credential: HarnessCredential, gateway: { baseUrl, headers } | null }
TerminalSpec  the same without `prompt`

ProcessSpec  { command, args, env /* to add or override */, unsetEnv /* to remove */, stdin: string|null,
               stdinOpen? /* S5.2 step 6: stdin stays open for messages mid-turn */,
               privateDir?: { env?, path: string|null, files: { name, contents, mode, option? }[] },
               turnFiles?: { name, contents, mode }[] /* written in TurnTools.dir */, notices: TurnEvent<'notice'>[] }
TurnTools    { dir /* the turn's own folder, 0700 */, command, args /* <node> <runner.mjs> mcp */,
               env /* MWC_ASK_SOCKET, MWC_ASK_TOKEN */ }

HarnessDriver { harness; versionArgs; turn(TurnSpec, TurnTools?): ProcessSpec; terminal(TerminalSpec): ProcessSpec;
                parser(): LineParser; inputLine?(text, id): string /* a message mid-turn's stdin line */ }
LineParser    { feed(line): TurnEvent[]; end(exitCode: number|null, stderrTail: string): TurnEvent[];
                settled?(): boolean /* every message taken answered: stdin may close */ }
```

- **Starting it.** The runner starts `command` with `args` (no shell) in `cwd`, from its own environment minus `MWC_*`
  and minus `unsetEnv`, plus `env`. It writes `stdin` (the prompt) and closes it, or with `stdinOpen` keeps it open for
  the person's messages while the turn runs ("Delivery while a turn runs" below); a terminal gets the pseudo-terminal
  instead (`stdin` is null). It sends `notices` as the turn's first events (a terminal shows them above the TUI).
- **The prompt is never an argument.** It goes on stdin: an argument would show in `ps` to every user of the machine,
  hit the argument length limit, and a one-word message such as `update`, `install` or `purge` would run that
  subcommand of `claude` (Commander dispatches on the first operand, even after `--`), `review` that of `codex exec`.
- **`privateDir`** (Codex's home, Claude Code's settings file): the folder a harness keeps its state or a process's
  private files in. The runner makes it private (0700) when missing, sets `env` to its path when there is one
  (`CODEX_HOME`; Claude Code has none), writes `files` before the start, adds `<option> <full path>` after `args` for
  each file with an `option` (Claude Code's `--settings`; only the runner knows the folder), and removes the files when
  the last process using the folder exits, so a secret is on disk only while a process runs. The folder is kept: Codex
  records its threads there, so a resume needs the same folder. `path` is the turn's `configDir`, or null for the
  runner's own private folder for this harness and `cwd`. A file of that name already there that the runner did not
  write must be set aside and put back, never overwritten (the runner's step).
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
| `init`        | `model` (string or null, ≤ 200), `effort?` (≤ 50), `cwd?` (≤ 4096), `slashCommands?` (≤ 200 of ≤ 100, no slash) | what the turn runs on: Claude's `system/init`; Codex says nothing of it, so none |
| `text`        | `text`, `parentId?`                                       | the assistant's text, as it comes                           |
| `thinking`    | `text` (≤ 20 000), `parentId?`                            | Claude's `thinking` blocks with text, Codex's `reasoning` items; a longer one is cut, ending in `TRUNCATED_MARKER` (`\n… [truncated]`) |
| `tool`        | `id`, `name`, `summary` (one line, ≤ 200), `parentId?`    | the input in one line: the command, file, pattern, address  |
| `tool_result` | `id`, `ok`, `summary` (≤ 500), `parentId?`                | the start of the result (Claude), the exit code and the end of the output (Codex commands) |
| `todo`        | `items` (≤ 100: `text` ≤ 300, `status` `pending` \| `in_progress` \| `completed`), `parentId?` | the whole to-do list as it is now (the latest replaces the one before): Claude's `TodoWrite` input (its `tool` event comes too), Codex's `todo_list` item (done or not: `completed` or `pending`) |
| `subagent`    | `id` (its Agent call's id), `agentType` (≤ 100), `description` (≤ 200), `model?`, `background?`, `status` (`running` \| `done` \| `failed` \| `interrupted`), `summary?` (≤ 4000, cut with the marker), `lastStep?` (≤ 200), `parentId?` | a subagent's whole state, each time it changes (the latest per `id` counts); Claude only |
| `usage`       | `inputTokens`, `outputTokens`, `cachedInputTokens?`, `costUsd?` | the turn's sum; input counts cached tokens too; Claude adds its cache writes and reads |
| `context`     | `inputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `outputTokens`, `window` (null: unknown) | the last request of the main agent; the conversation's size is `inputTokens + cacheReadTokens + cacheCreationTokens`; Claude only |
| `compact`     | `preTokens`, `postTokens` (null: not said), `trigger?` (`manual` \| `auto`) | a compaction of the conversation: Claude's `system/compact_boundary` |
| `notice`      | `level` (`info`, `warn`), `message` (≤ 2000), `parentId?` | a tool refused for permission, a retried request |
| `input`       | `text` (1–20 000), `inputId?` (the message's id, `turn.input`'s) | a message the person sent into the running turn, where the harness took it (S5.2 step 6): Claude Code's echo of it, kept by the runner only for a message it wrote |
| `result`      | `ok`, `text?` (the reply), `error?` (≤ 2000), `durationMs?` | the last event of the harness's output                     |
| `question`    | `id` (the runner's UUID), `questions` (1–4, "Asking the person") | the agent asked the person through the runner's tool: a `turn.question` frame, never a parser's |
| `answered`    | `questionId`, `turnId` (the turn that carried the answers), `answers` (1–4 `{question, picked[], other?}`) | the person answered: the server adds it to the question's turn after its end |

A runner sends them as `turn.events`, each with its `seq` from 1 (docs/runner-protocol.md, "Chat turns"); a long text is
split into several `text` events, each keeping its `parentId`.

- **`parentId`** (S5.2) is the id of the Agent (or Task) call that started the subagent the event belongs to (Claude's
  `parent_tool_use_id`, the direct parent: a subagent's own subagent names it); the main agent's events have none. A
  reader that shows the main reply skips events with a `parentId` and folds them under that subagent instead.
- **The context window** is `contextWindowOf(model)` of `@mwc/shared/harness` (`harness/context.ts`): the model
  catalogue's own window first (`@mwc/shared/models`, docs/subscriptions.md "Model and effort"), else the longest
  matching prefix of a table of the Claude models (the 5 family and Opus/Sonnet 4.6+ at 1M, the older 4.x at 200k,
  Claude Code's aliases `opus`, `sonnet`, `haiku`, `fable` at 1M, an id with `[1m]` at 1M, Bedrock and router prefixes
  stripped) and the OpenAI ones as Codex sizes them (the GPT-5 and GPT-6 families 272k, `gpt-4.1` 1 047 576, `o3`, `o4-mini` and
  `codex-mini` 200k, `gpt-oss` 131 072); unknown models are null. Claude's `result.modelUsage[].contextWindow`, when it
  differs and is not smaller than what the conversation already holds, gives the last `context` again with it.
- **Old events stay valid**: every field added in S5.2 is optional, and the new types are new.
- **Questions** (S5.2 step 4): a harness's parser never gives `question` or `answered`. The runner numbers a question
  among the turn's events (it sends the ones before it first), and the server writes `answered` after the turn ended,
  numbered after its last event, so a reader shows them in place.

## Credentials and gateways

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

The profile's gateway (docs/subscriptions.md, "Gateways"; universal since 2026-11-10: any profile takes any gateway)
decides where a turn's and a terminal's AI requests go, over the machine's own settings (since 2026-11-10). The server
derives `<baseUrl>` from the gateway's address and the path of the turn's route (`gatewayRouteOf` and
`gatewayAddressOf` of `@mwc/shared/credentials`, in the credentials module's `harnessGatewayOf`): Claude Code takes the
address + the `claude` path (default `""`), Codex with `codex_oauth` the address + `codexChatgpt` (default
`/backend-api/codex`), Codex with `openai_api_key` the address + `codexApiKey` (default `/v1`). The join has no double or
trailing slash, and an address that already ends with the path is kept. With Ihor's memory gateway
`http://127.0.0.1:8300` that is `http://127.0.0.1:8300`, `…/backend-api/codex` and `…/v1`. The drivers take
`gateway.baseUrl` as it comes:

| Credential + gateway          | Arguments                                                                                 | Environment                                         | Private files (0600, removed after the process) |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Claude Code, any, gateway     | `--settings <file>`                                                                       | the credential's; `ANTHROPIC_BASE_URL=<baseUrl>`, `ANTHROPIC_CUSTOM_HEADERS` when it has headers | `settings-<12 hex>.json`: `{"env":{"ANTHROPIC_BASE_URL":"<baseUrl>","ANTHROPIC_CUSTOM_HEADERS":"<Name: value lines>"}}` |
| Claude Code, any, none        | `--settings <file>`                                                                       | the credential's; both variables unset              | the same file: `{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com","ANTHROPIC_CUSTOM_HEADERS":""}}` |
| Codex, `codex_oauth`, gateway | `-c model_provider="mwc_gateway"`, `…name="Most Wanted gateway"`, `…base_url="<baseUrl>"`, `…wire_api="responses"`, `…requires_openai_auth=true` | `MWC_GATEWAY_SECRET_HEADER_<n>` per header | `auth.json` (the login) |
| Codex, `openai_api_key`, gateway | the same with `…env_key="CODEX_API_KEY"` in a turn; `…requires_openai_auth=true` in the terminal (its key is in `auth.json`) | turn: `CODEX_API_KEY`; `MWC_GATEWAY_SECRET_HEADER_<n>` | terminal: `auth.json` with the key |
| Codex, any, none              | `-c model_provider="openai"` (Codex's built-in provider)                                   | the credential's                                    | as without a gateway                            |

`…` is `model_providers.mwc_gateway.`. A Codex gateway's headers go as `…env_http_headers={ "<name>" = "MWC_GATEWAY_SECRET_HEADER_<n>" }`
(an inline TOML table, `<n>` from 1 in the headers' order), their values only in the process's environment: no header
value, key or token is ever an argument, where every user of the machine would see it in `ps`.

## Claude Code

Verified against `claude --help` 2.1.319; the input mode against 2.1.321 (S5.2 step 6); `--settings` against 2.1.322.

```
turn:      claude -p --output-format stream-json --verbose --input-format stream-json --replay-user-messages
                  [--resume <id>] [--model <m>] [--effort <e>] [--dangerously-skip-permissions]
                  the prompt as the first user message on stdin, which stays open
           with the runner's tools, after those:
                  --mcp-config <dir>/mcp.json --allowedTools mcp__mwc__ask_user_question
                  --append-system-prompt "When the person must choose between options, ask them with the
                  ask_user_question tool, then end your turn: their answer comes as their next message."
terminal:  claude [--resume <id>] [--model <m>] [--effort <e>] [--dangerously-skip-permissions]
both:      and always, last:  --settings <runner state>/claude_code/<16 hex of sha256(cwd)>/settings-<12 hex>.json
env:       the credential's variable; CLAUDE_CONFIG_DIR=<configDir> when set; with a gateway
           ANTHROPIC_BASE_URL=<baseUrl> and ANTHROPIC_CUSTOM_HEADERS="Name: value" one per line
```

- **The profile's gateway wins** (`settings.ts`, 2026-11-10). A machine's `~/.claude/settings.json` `env` (Ihor's Mac:
  his memory gateway with `x-memory-*` headers; the devbox: the Airia dev gateway with an `x-airia-key` header), or a
  project's, is applied over the process's environment, so the turn's variables alone did not decide. Every turn and
  terminal therefore gets a private settings file named with `--settings` (`claude --help` 2.1.322: `--settings
  <file-or-json>`, "Path to a settings JSON file or a JSON string to load additional settings from"): with a gateway
  `{"env":{"ANTHROPIC_BASE_URL":<baseUrl>,"ANTHROPIC_CUSTOM_HEADERS":<Name: value lines>}}`, without one Anthropic's own
  address and no headers. Settings given this way (Claude Code's `flagSettings`) rank above user, project and local
  settings; only managed (policy) settings rank higher: Claude Code 2.1.322's own setting sources are ordered `userSettings`,
  `projectSettings`, `localSettings`, `flagSettings`, `policySettings`, "low-to-high priority — later entries override
  earlier ones", and each source's `env` is assigned over the process's environment in that order. The variables stay
  as well (a host that withholds settings' provider variables still gets them). The file is the driver's
  (`settings-<12 random hex>.json`, its own per process, so two chats on one agent folder with different profiles do not
  share one), written 0600 by the runner in its private folder for Claude Code and the agent's folder (never
  `CLAUDE_CONFIG_DIR`), named after the other arguments, and removed when the last process using that folder ends.
  Other provider settings a machine may set (`ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`) are not overridden by it.

- **Input mode** (S5.2 step 6, `input.ts`): every turn reads its messages as stream-json, one user message a line,
  `{"type":"user","uuid":<id>,"session_id":"","parent_tool_use_id":null,"message":{"role":"user","content":[{"type":
  "text","text":<text>}]}}`: the prompt first, then each message sent Now (`inputLine`). With
  `--replay-user-messages` Claude Code echoes each message it takes as a `user` message with `isReplay: true` and its
  `uuid`, which the parser gives as `input {text, inputId}`. A message sent mid-turn is taken at the turn's next step;
  one that comes as the turn ends runs as one more turn in the same process, with its own result. The parser is settled
  at a `result` whose `queued_turn_count` is 0 (or absent); a result that says a message waits, and any echo after a
  result, keep it reading. A Compact's `/compact` goes as the first message the same way (as the Agent SDK sends slash
  commands); that it runs as the command in this mode is not verified without a real turn.
- **Permissions.** `bypass` adds `--dangerously-skip-permissions`. `ask` adds nothing: in `-p` there is no one to ask,
  so a tool that needs approval is refused, the model is told, and the `result`'s `permission_denials` become `warn`
  notices (`Refused for permission: Bash (rm -rf build)`). In the terminal Claude Code asks the person on the TUI.
- **Parsing** (`stream-json`, `connectors/harness-claude-code/src/`): the first message with a `session_id`
  (`system/init`) gives `session`, and `system/init` gives `init` (`model`, `effort` when it says one, `cwd`,
  `slash_commands`; `system.ts`); `assistant` text blocks give `text`, `thinking` blocks with text give `thinking`
  (Claude Opus 5.5 sends them empty unless asked to show them: nothing then), `tool_use` and `server_tool_use` give
  `tool`; `user` `tool_result` blocks give `tool_result` (`is_error` → not ok); `system/api_retry` gives an `info`
  notice; `system/compact_boundary` gives `compact` (`compact_metadata.pre_tokens`, `post_tokens`, `trigger`); `result`
  gives the denials' notices, `usage` (`usage`, `total_cost_usd`) and `result` (`is_error` or a subtype other than
  `success` → not ok, with the `result` text, the `errors` or the subtype in words; `duration_ms`). The result is the
  last event: lines after it give nothing (`parser.ts`).
- **Context** (`context.ts`): after each `assistant` message of the main agent with a `usage`, `context` with that
  request's tokens and `contextWindowOf` of `init`'s model (else the first message's). Claude Code writes one line per
  content block, each with the same message id and usage: a message gives one event. Its own messages (model
  `<synthetic>`, an API error shown as a reply) give none. A compaction forgets the last one (the next message measures
  again); at the `result`, the window `modelUsage` reports for the main model (or its only model) gives the last
  `context` again when it differs and is not smaller than the conversation's size.
- **To-dos**: a `TodoWrite` call gives its `tool` and a `todo` with its `todos` (`content`, `status`; an unknown status
  is `pending`).
- **Subagents** (`subagents.ts`): an `Agent` call (`Task` before 2.1, or any call naming a `subagent_type`) gives its
  `tool` and a `subagent` `running` (`subagent_type`, else `general-purpose`; `description`; `model`;
  `run_in_background`). Its own messages carry its call's id as `parent_tool_use_id`, so their events carry it as
  `parentId` (no `context`). `system/task_started` ties Claude Code's `task_id` to the call (`is_backgrounded`),
  `task_progress` gives its `description` as `lastStep`, `task_updated` its `patch` (`status`, `is_backgrounded`,
  `description`). It ends with its call's `tool_result` (`done`, or `failed` on an error; `summary` its text without
  the `agentId: …` and `<usage>…</usage>` trailer) or `task_notification` (`completed` → `done`, `failed`, `killed`,
  `stopped` or `cancelled` → `interrupted`; `summary` its summary). A background subagent's call answers at once
  (`Async agent launched successfully`): it stays `running` until its notification. One still running at the `result`,
  or when the process ends without one, becomes `interrupted` before the turn's last event. Task messages of anything
  else (a background command) give nothing.

## Codex

Verified against `codex --help`, `codex exec --help`, `codex exec resume --help` and `codex resume --help` 0.162.1 (the
sign-in helper pins 0.163.0), and the documented `--json` events (`codex-rs/exec/src/exec_events.rs`).

```
turn, new:      codex exec --json --skip-git-repo-check [--model <m>] [-c model_reasoning_effort="<e>"] <permissions>
                [<tools>] -
turn, resume:   codex exec resume --json --skip-git-repo-check [--model <m>] [-c …] <permissions> [<tools>] <threadId> -
tools:          -c mcp_servers.mwc.command="<node>" -c mcp_servers.mwc.args=["<runner.mjs>","mcp"]
                -c mcp_servers.mwc.env_vars=["MWC_ASK_SOCKET","MWC_ASK_TOKEN"]
                -c mcp_servers.mwc.default_tools_approval_mode="approve"     and both variables in codex's env
terminal:       codex [resume] [--model <m>] [-c …] <permissions> [<threadId>]
permissions:    bypass  --dangerously-bypass-approvals-and-sandbox
                ask     turn: -c sandbox_mode="workspace-write" -c approval_policy="never"
                        terminal: --sandbox workspace-write --ask-for-approval on-request
provider:       gateway   -c model_provider="mwc_gateway" -c model_providers.mwc_gateway.name="Most Wanted gateway"
                          -c model_providers.mwc_gateway.base_url="<baseUrl>"
                          -c model_providers.mwc_gateway.wire_api="responses"
                          -c model_providers.mwc_gateway.requires_openai_auth=true     (a login; a key in the TUI)
                       or -c model_providers.mwc_gateway.env_key="CODEX_API_KEY"         (a key in codex exec)
                          [-c model_providers.mwc_gateway.env_http_headers={ "<name>" = "MWC_GATEWAY_SECRET_HEADER_<n>", … }]
                none      -c model_provider="openai"
                after the permissions, before the tools (turn: … <permissions> <provider> [<tools>] [<threadId>] -)
home:           privateDir CODEX_HOME = configDir, or the runner's own folder for this cwd
```

- **Why `-c` for the turn's sandbox.** `codex exec resume` has no `--sandbox`; the config overrides work for both
  forms. With approvals off, what the workspace-write sandbox does not allow fails and the model is told; a command
  Codex reports `declined` gives a `warn` notice.
- **The trailing `-`** makes Codex read the prompt from stdin (after the thread id on a resume).
- **The gateway** (`gateway.ts`, 2026-11-10) is a custom model provider given as config overrides, which win over any
  `config.toml` in Codex's home folder; Ihor's own `~/.codex/config.toml` (his `memory-gateway` provider) is never read,
  since `CODEX_HOME` is the runner's folder. Each key was checked against Codex 0.162.1's own config loading
  (`CODEX_HOME=<an empty scratch folder> codex -c … mcp list`, which loads the config and makes no network call): the
  exact overrides of each case load; `model_provider` naming an undefined provider fails ("Model provider `x` not
  found"); a wrong type fails naming the key (`model_providers.mwc_gateway.name`, `.base_url`, `.env_key` and the
  `env_http_headers` values must be strings, `env_http_headers` a map, `requires_openai_auth` a boolean); `wire_api`
  takes `responses` only; an unknown key is ignored silently (so the type checks are what prove the names). A ChatGPT
  login authenticates with `requires_openai_auth=true`, as Ihor's own config does; an API key in `codex exec` with
  `env_key` naming `CODEX_API_KEY`, the variable it is already in; the TUI reads its key from `auth.json`, so it also
  uses `requires_openai_auth=true`. Headers go as `env_http_headers`, each naming a variable `MWC_GATEWAY_SECRET_HEADER_<n>`
  whose value is in the process's environment (the runner strips its own `MWC_*` variables, never the driver's).
  Without a gateway the turn names `model_provider="openai"`, the built-in provider, so a placement's config folder
  cannot send it elsewhere (its `openai_base_url`, if it sets one, is not overridden). No notice: the old "gateway is
  not used" notice is gone.
- **Parsing** (`--json`): `thread.started` gives `session` (`thread_id`); `item.started` of a command, an MCP call or a
  web search gives `tool` at once; `item.completed` gives `text` (`agent_message`, kept as the reply), `tool` when not
  shown yet and `tool_result` (a command: `exit <code>: <the end of its output>`; a file change: applied or failed; an
  MCP call: its text or its error), a `warn` notice for an `error` item; `turn.completed` gives `usage`; `turn.failed`
  gives a failing `result`; an `error` event gives a `warn` notice (Codex also reports retries it recovers from this
  way) and is the failure's detail when the turn does not complete. A completed `reasoning` item with text gives
  `thinking`; the `todo_list` item gives `todo` when it starts, on each `item.updated` that changes it and when it
  completes (its `items`' `text`, `completed` → `completed`, else `pending`). Codex has no result event: a clean exit
  (0) after `turn.completed` gives `result` ok with the last agent message. Codex says nothing of its model, and its
  usage is the turn's sum rather than the last request's, so a Codex turn gives no `init` and no `context`; it has no
  subagents and no `parentId`.

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
   CLI; the profile (the chat's, else the agent's), of the provider the harness runs on (Claude Code: a Claude profile;
   Codex: an OpenAI profile; else `profile_harness_mismatch`), with its gateway (its address with the route's path, by
   the harness and the credential's kind), and its subscription (`profile_empty`
   when it has none). The spec's model and effort are that profile's (since 2026-11-10; docs/subscriptions.md "Model
   and effort"): none for the provider's default, and Codex's old marker `codex-default`, a Claude id on Codex or an
   effort the harness does not take give way to the harness's own default (`turnModel`, `turnEffort`).
3. **The credential** is opened by the credentials module as its owner (`credentialsForHarness`): one
   `credential_uses` row per turn, naming the company, the agent, the chat and who sent the prompt (`chat_turn`;
   `chat_terminal` for a terminal), and one for the gateway. A Claude login whose access token has under 60 minutes left
   is refreshed first (Claude Code's own refresh call, the new token set sealed again); a Codex login whose token is near
   its end the same way as its usage check. A refused refresh marks the login `needs_sign_in`
   (`credential_needs_sign_in`); a provider that does not answer keeps a token that still works, else
   `provider_unavailable` (503). The secret goes with this turn only, in `turn.start` over the runner's link: Claude's
   token is the process's `CLAUDE_CODE_OAUTH_TOKEN`, never on disk; Codex's `auth.json` and Claude Code's settings file
   (the gateway's headers) are on disk only while their process runs. The gateway goes with its headers to either
   harness ("Credentials and gateways").
4. **The turn** is recorded `running` (with the profile and credential it runs on; the first prompt is the chat's title,
   80 characters), its sink is put in place, and `turn.start {turnId, spec}` goes to the runner. The answer is 202 with
   the turn.
5. **The runner** (`turns/turns.ts`, `turn.ts`) refuses at once with `turn.end {ok: false, exitCode: null, error}`
   what it cannot run: `unsupported` (no such CLI, even after searching again, or no way to start processes), `busy` (all `slots` live), `home_missing`
   (the agent's folder is not there), `invalid_spec: …` (the driver refused the spec), `spawn_failed: …`,
   `runner_stopping`. Otherwise it starts the driver's command with no shell, detached (its own process group), in the
   agent's folder, with its own environment less `MWC_*` and the driver's `unsetEnv`, plus `env` and the private folder's
   variable; writes the prompt to stdin and closes it (Claude Code's turns keep it open for the person's messages until
   their result, "Delivery while a turn runs"); sends the driver's notices as the first events; reads stdout line
   by line into the driver's parser and keeps the last 4 KB of stderr. Events go as `turn.events` about 100 ms after the
   first, or at once from 32 KB or 100 events, numbered from 1; a text event over 16 KB is split, a result's text cut to
   fit. On exit, `parser.end` gives the last events, then `turn.end {ok, exitCode, error?, authJson?}`: `ok` is the
   result's, `error` is `stopped` after `turn.stop` (SIGINT to the group, SIGTERM 5 s later, SIGKILL 10 s after the
   SIGINT) or `runner_stopping`. Live turns hold the machine as live runs do and make the self-update say `busy`.
6. **The private folder** (`turns/private-dir.ts`): Codex's is the placement's `configDir` when it has one, else
   `<runner state dir>/<harness>/<first 16 hex of sha256(home)>/`, never the machine's `~/.codex`; Claude Code's is always
   the runner's own (`<state>/claude_code/<16 hex>/`), never `CLAUDE_CONFIG_DIR`; made 0700. `auth.json` and Claude
   Code's `settings-<12 hex>.json` are written 0600 before the process (a marker file first; a file of that name the
   runner did not write is set aside and put back), the settings file named on the command line (`--settings <path>`,
   `withPrivateDir`), and removed when the last process using the folder ends. When the process rewrote it (its own token
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
  now, then one `--version`). When found, the turn runs it and the next hello carries its version. The server refuses a
  harness its view of the runner says is missing (`harness_missing`); since 2026-11-10 that view follows `runner.caps`,
  which the runner sends after the Machines page's **Check again** or **Install** (docs/machines.md, "Tools"), so a CLI
  installed later counts at once, with no reconnect.
- `install` puts the usual folders that exist on the service's PATH too (docs/machines.md, "Install").

`ask` in chat mode refuses a tool that needs approval (Claude Code's denials and Codex's declined commands become `warn`
notices) until S6 brings the permission round trip; the terminal asks the person on the TUI. No test runs a real
`claude` or `codex` turn: that spends Ihor's subscription.

## Asking the person

Built in S5.2 step 4 (2026-11-10): selections. An agent asks the person multiple-choice questions through an MCP tool
its turn gets from the runner; the questions show as a card in the chat; the person's picks go back as the chat's next
prompt. The same bridge is where S6's tool approvals will ride.

- **The tool**, `ask_user_question` (`apps/runner/src/turns/ask/tool.ts`), in the shape of Claude Code's own
  AskUserQuestion: `{ questions: [{ question (1–500), header (1–12), options: [{ label (1–60, unique), description
  (≤ 200) }] (2–8), multiSelect }] (1–4, each asked once) }` (`AskInput` of `@mwc/shared/harness`; the limits are
  `ASK_LIMITS` of `@mwc/shared/chats`, which the web reads too). Its description says when to use it; annotated
  read-only. A valid call is answered at once: "Your question is shown to the person. End your turn now; their answer
  comes as their next message." A bad input is an MCP tool error (`isError`) listing what to fix, so the model corrects
  it; the runner is not asked.
- **The MCP server**, `node runner.mjs mcp` (`turns/ask/command.ts`, `mcp.ts`): JSON-RPC 2.0 by hand over stdio, one
  message a line, no dependency. It answers `initialize` (tools only; the version the client asks for when it speaks it,
  `2025-06-18`, `2025-03-26` or `2024-11-05`, else the newest), `ping`, `tools/list`, `tools/call`; notifications
  (`notifications/initialized`) get no answer, an unknown method -32601, an unknown tool -32602, a line that is no JSON
  -32700, a message that is no request -32600. Answers go out as each is ready; it exits 0 when stdin ends. Without its
  variables a call says it works only inside a chat turn.
- **The bridge** (`turns/ask/bridge.ts`, `client.ts`): before each turn's process the runner makes the turn's own folder
  `<state>/turns/<12 hex>/` (0700), listens on a Unix socket `ask.sock` in it (Node binds the path at once, before the
  spawn) and draws a random 32-byte token. The MCP server reaches it through `MWC_ASK_SOCKET` and `MWC_ASK_TOKEN`: one
  connection per call, one line out (`{token, questions}`), one line back (`{ok: true, text}` or `{ok: false, error}`),
  10 s at most, 64 KB a line. A wrong token is refused (logged, never the token), questions are checked again. The turn
  answers: it flushes its batched events, takes the next event number, sends `turn.question {turnId, seq, questionId,
  questions}` and returns the text; once the turn is stopping it answers that the question was not shown, and while the
  link is down the same. When the process ends the socket closes and the folder goes with its files. A socket path over
  103 bytes (macOS's limit) or a folder that cannot be made runs the turn without the tool, logged.
- **The harnesses.** Claude Code gets `--mcp-config <dir>/mcp.json` (`{mcpServers: {mwc: {type: 'stdio', command,
  args, env}}}`, written 0600 by the runner from the driver's `turnFiles`, so the token is never on a command line),
  `--allowedTools mcp__mwc__ask_user_question` (the `ask` policy refuses tools that need approval in print mode) and one
  `--append-system-prompt` line. Codex 0.162.1 takes MCP servers as config overrides (verified with `codex mcp list` on
  an empty `CODEX_HOME`: `env_vars` takes names, `default_tools_approval_mode` one of `auto`, `prompt`, `writes`,
  `approve`): its server's command and arguments, `env_vars` naming the two variables (set in codex's own environment,
  so the token is not on its command line either) and `approve` (a turn's approvals are off). Codex gets no extra
  instruction line: its `developer_instructions` would replace the agent's own; the tool's description says when to
  use it. Whether `codex exec` then calls the tool is not verified without a real turn.
- **The server** (the chats module): `turn.question` is stored as the turn's `question` event and streamed like the
  others. The chat's detail has `question`: the latest question of its last turn while no `answered` event names it
  (`rules/questions.ts`), else null. `POST …/chats/{chatId}/answers {questionId, answers: [{question, picked[],
  other?}]}` (admins and owners) checks the answers fit (each names a question asked, once; picks only its labels, once
  each; one for a single choice: else 422 `invalid_answers` saying why), then starts the next turn as any prompt
  (refused as any turn is: `turn_running` while the asking turn still runs), with the prompt `My answers to your
  questions:` and one line per question in order, `<n>. <question> → <picks>`, `; Other: <words>` for the person's own,
  `skipped` for a question left out. In the transaction that records that turn the question must still be open (its
  turn right before: else 409 `question_closed`), and the asking turn gets `answered {questionId, turnId, answers}`
  after its last event, streamed before the new turn. 404 `question_not_found`; 409 `question_closed` for a question
  answered already, a later question of the same turn, or any newer turn: a plain message instead closes it
  (`superseded`) without a mark, as the thread shows it. No migration: both marks are events.
- **The web** (`apps/web/src/features/chats/thread/question/`): the card under the agent's reply while open (one
  question per page, "1 of N" and arrows, the headers as steps, option rows as a radio group or checkboxes with their
  descriptions and keys 1–9, a filter over 6 options, an "Other" box, Skip, Next and "Send answer"; Left and Right turn
  pages; drafts kept while the page lives); answered: "You answered" with each header's picks; superseded: "answered in
  a message". The tool's own call shows no tool row, and the turn that carried the answers shows no prompt bubble. The
  composer stays open: a message instead answers in words.

## Delivery while a turn runs

Built in S5.2 step 6 (2026-11-10): the composer stays open while the agent works, and a message sent then reaches it
Now (into the running turn), After this turn (queued) or by Interrupt. The server side is the chats module's queue
(`service/queue.ts`, `service/drain.ts`, `rules/queue.ts`, `repo/queue.ts`); the runner's is `turns/input.ts`.

- **The queue.** A chat has at most one `running` turn and up to `CHAT_QUEUE_MAX` (10) `queued` ones (migration
  `0014_chat_turn_queue`: the partial unique index is on `running` only, and `chat_turns.delivery` is `now`, `after`,
  `interrupt` or null for a turn that started at once). `POST …/chats/{chatId}/turns {prompt, delivery}` (admins and
  owners): with nothing running or waiting it starts at once as before (refusals and all, `delivery` null); otherwise
  202 with a `queued` turn (409 `queue_full` past ten). Without `delivery` a running turn still refuses the prompt
  (`turn_running`), for API callers that know nothing of the queue.
- **After this turn** (`after`): waits. **Interrupt** (`interrupt`): the running turn is stopped by its stop ladder
  (`turn.stop`), and this one starts first. **Now** (`now`, Claude Code's message turns only; 409 `now_unsupported` for
  Codex and during a compaction): the turn waits as `queued`, unchangeable, and goes to the runner as `turn.input
  {turnId, inputId: <its id>, text}`; when the harness takes it, its `input` event (stored in the running turn) removes
  the waiting turn (the stream says `removed`). If the running turn ends without taking it (it came too late, the
  runner is older than `turn.input`, or the harness dropped it), it is still waiting and starts first.
- **Starting the next one** (`drain.ts`): after every turn's end (done, failed or stopped, a dropped link too) and after
  every message queued or moved up, while nothing runs, the next waiting turn (`queueOrder` of `@mwc/shared/chats`:
  Now and Interrupt first, then After, each oldest first) starts as a prompt does, as the person who sent it (the
  checks, a `credential_uses` row, the runner), resuming the chat's session. One the checks refuse fails with the
  refusal's words ("The agent's machine has no connected runner") and the next is tried. A turn that starts after a
  later one (it was overtaken) takes the next number after the chat's last, so the turns that started are numbered in
  start order and `Last-Event-ID` still reads them in order. One chat's starts run one at a time in the server process;
  a start that loses to another (the index) leaves the chat to it. At the server's start the queued turns fail with
  the running ones (`server_restarted`).
- **Waiting messages** (admins and owners, 409 `turn_not_queued` once it started or ended, `message_sent` for one sent
  Now): `PATCH …/turns/{turnId} {prompt}` changes its prompt (200); `DELETE …/turns/{turnId}` discards it (204, the
  stream says `removed`); `POST …/turns/{turnId}/deliver {delivery: 'now'|'interrupt'}` sends it Now or makes it
  interrupt (202). The detail's `queue` lists the waiting turns' ids in start order; each turn has its `delivery`.
- **The input mode on the runner** (`turns/input.ts`): a process whose spec says `stdinOpen` gets the prompt and keeps
  stdin; `turn.input` writes the driver's `inputLine(text, inputId)` (once per id), and the parser's `input` events are
  kept only for the ids this turn wrote, with the text written (the prompt's own echo goes). After a `result`, stdin
  closes once every message written was taken and the parser is settled, so the process ends as before; while one
  still waits, it stays open until the harness prints nothing for `INPUT_QUIET_MS` (30 s). A stop, the end, a turn that
  takes no input (Codex) or a closed stdin drop `turn.input` (logged), and the server starts the message next.
- **The web** (`apps/web/src/features/chats/delivery/`): while a turn runs the composer shows "The agent is working —
  send: Now · After this turn · Interrupt" (Now only where it works; the last choice remembered in the browser,
  `mwc.chat.delivery`), Stop beside Send, and the waiting messages above the box in start order, each saying what
  happens to it ("Queued — starts after the current turn", "Interrupting the turn — starts next", "Sending into the
  running turn…") with Edit, Send now, Interrupt and Discard. A message the turn took shows in the reply where it was
  taken, "Sent into the running turn"; a turn that interrupted says "Interrupted the turn" under its prompt.

### Open in Claude Code

The chat's header has "Open in Claude Code" ("Open in Codex") for admins once the chat has a conversation: a popover of
commands that resume it in the person's own terminal, each with a copy button (`resumeCommands` of
`@mwc/shared/resume`). The folder is the conversation's own (its last `init`'s `cwd`), else the agent's home while it is
still on the chat's machine; the agent's config folder goes along (`CLAUDE_CONFIG_DIR=`, Codex's `CODEX_HOME=`).

```
a Mac or another machine:   cd '<folder>' && claude --resume <sessionId>
the devbox (from the Mac):  airia devbox ssh -- -t "cd '<folder>' && claude --resume <sessionId>"
a Docker runner:            docker exec -it <container> sh -lc "cd '<folder>' && claude --resume <sessionId>"
Codex:                      codex resume <sessionId> in the same places
```

Paths are single-quoted (`'` as `'\''`) and a command that crosses a second shell is double-quoted once more (`\`, `"`,
`$` and backquotes escaped); a test reads them back through `/bin/sh`. The popover says it uses that machine's own
login, not the chat's access profile, and that typing there spends it; a Codex chat's thread lives in the runner's
own folder unless the agent has a config folder, which it says too.

## Compact and Clear

Built in S5.2 step 1 (2026-11-09), for the chat page's Compact and Clear. A chat's turns have a `kind`
(`chat_turns.kind`, migration `0013_chat_turn_kind`, `message` by default):

- **Compact** (`POST …/chats/{chatId}/compact`, admins and owners): a turn of kind `compact` with the prompt
  `/compact`, which Claude Code runs as its own command in `-p` on the chat's session. It is refused as any turn is
  (`chat_archived`, `turn_running`, the placement, the machine, the profile…), and with 409 `nothing_to_compact` when
  the chat has no session yet, `compact_unsupported` for a Codex chat (`codex exec` runs no slash command; Codex
  compacts by itself). 202 with the turn; its events come on the stream: `compact` (the sizes before and after), the
  usage and an empty `result`.
- **Clear** (`POST …/chats/{chatId}/clear`, admins and owners): runs nothing. In one transaction it records a turn of
  kind `clear` (prompt `/clear`, `done` at once, `started_at` = `ended_at`, on no profile or credential; a CHECK holds a
  `clear` turn to `done` and no credential) and sets the chat's `session_id` to null, so its next turn starts a new
  conversation; the old one stays on the machine, unused. 409 `chat_archived`, `turn_running` (checked in the
  transaction) or `nothing_to_clear` (no session). 200 with the turn, which the stream also sends as a `turn` message.
  A Clear is a turn rather than a table of markers of its own: it takes its place in the chat's order (`seq`), the
  detail, the stream and its `Last-Event-ID` replay carry it with no new message type, and the thread draws it as a
  divider. It is not audited: the turn row names who cleared and when, as a prompt's turn does.
- **The detail** (`GET …/chats/{chatId}`) adds `init` (the last `init` event since the chat's last Clear) and `context`
  (`{usedTokens, window, model, at}`: the last `context` event's input + cache reads + cache writes, or a later
  `compact`'s `postTokens`; the window from the event, else `contextWindowOf` of `init`'s model, else the window of what
  the chat's access profile runs, `profileWindowOf`; null before anything
  measured the conversation since the last Clear), from the chat's events (the chats module's `conversationState`). A
  page following the stream applies the same rule to the events it gets.

### Reading a long chat

Built 2026-11-10 (Ihor: "Whenever I'm doing CLEAR context, those OLD [messages] should automatically collapse, with an
ability to expand… lazy loading"). The detail no longer carries every turn:

- **The detail** (`GET …/chats/{chatId}`) holds the **current conversation**: the turns after the last `clear` turn,
  that Clear first, the latest 30 (`CHAT_WINDOW`) with their events. `earlier` says what it left out: `before` (the
  first returned turn's number while older turns of the current conversation are left out, else null), `turns` (how
  many), and `conversations` (one per Clear, newest first: `clearTurnId`, `clearSeq`, `clearedAt`, `turns` without the
  Clears, `from`/`to` the first and last turn's times). `init`, `context`, `question` and `queue` read as before;
  `init` and `context` still read the whole current conversation (the left-out turns' `init`, `context` and `compact`
  events only).
- **Older turns** (`GET …/chats/{chatId}/turns?beforeSeq=&afterSeq=&limit=`, members and above): the latest `limit`
  (1–50, default 20) before `beforeSeq` and after `afterSeq` (both exclusive, `afterSeq` 0 by default), in order with
  their events, and `more`. The web pages back from `earlier.before` with `afterSeq` one before the last Clear, and loads
  a conversation with its `clearSeq` and the next older one's.
- Every query rides the turns' unique `(company_id, chat_id, seq)` index and the events' key: no migration. The stream
  and its `Last-Event-ID` replay are unchanged; a page reconnects from its window's last event, never from a paged one.
- **The page** folds each conversation before a Clear into a bar ("Earlier conversation · 12 messages · 21:02–23:38",
  cleared at its time) that loads its turns once and opens them in place, softer; a "Load older messages" row at the top
  of the current conversation loads the next page by itself when it scrolls into view and keeps the reader's place. A
  Clear made on the page reloads the detail, so what it ended folds at once. The context meter and the turn model read
  only the current conversation (the meter's totals count its loaded turns). Not yet: events loaded lazily inside a
  huge turn, search.

## Tests

- Each connector's tests run every argument and environment combination and parse its fixtures, written from the
  documented formats, never recorded from a real turn (that would spend a subscription): Claude Code's `answer`, `tool`,
  `denied`, `error`, `resume`, `subagent` (a plan with `TodoWrite`, an Explore subagent with its own steps and `task_*`
  messages, one in the background ended by `task_notification`) and `compact`; Codex's `answer`, `tool`, `denied`,
  `error`, `resume` and `plan` (its to-do list started, updated and completed, reasoning). The runner's tests reuse them
  from `@mwc/harness-claude-code/fixtures` and `@mwc/harness-codex/fixtures`.
- The delivery (S5.2 step 6) is tested without a real CLI: the Claude driver's arguments and stdin lines, its parser's
  echoes, results that say a message waits and a turn that goes on after its result; the runner's stdin (closed for a
  harness without input, the first message, `turn.input` written once, echoes kept or dropped, closed after a settled
  result or a quiet wait, a stop) on fake processes and through the real driver; the server's queue on PGlite with
  `FakeRunner` (after, interrupt, now taken and not taken, the cap, starts after a done, failed, stopped or dropped turn,
  a refusal in words, an archived chat, renumbering, edit, discard and deliver while waiting only, roles, the old
  refusal without a delivery, races), the migration's index and the resume commands' quoting.
- The question bridge is tested in parts, in-process, never with a real CLI: the MCP server's JSON-RPC (initialize,
  tools/list, a valid call relayed, an invalid input, an unknown tool and method, notifications, parse errors), the
  `mcp` command on fake stdio, the socket with its token on a real Unix socket in a temporary folder (a wrong token, a
  long request, no socket, a silent one), a turn on the fake driver whose fake process calls the socket (its
  `turn.question` numbered after the events before it, refused while stopping or offline, the folder removed after),
  each driver's arguments, and the server's frame, detail, stream and answers route on PGlite with `FakeRunner`.
- The fake binary, `node FAKE_HARNESS_BIN`, plays a `FakeScenario` JSON file named by `FAKE_HARNESS_SCENARIO`: it reads
  stdin, writes what it got (argv, cwd, stdin, only the variables `recordEnv` names) to `record`, prints `lines` (after
  `delayMs` each), then `stderr`, waits `holdMs` and exits with `exitCode`. A runner test points `FakeHarnessDriver` at it
  (`command: process.execPath, args: [FAKE_HARNESS_BIN], env: { FAKE_HARNESS_SCENARIO }`) with `fakeLines(events)`, or
  replaces a real driver's command with it to play a CLI fixture through the real parser.

## Not supported yet

- The journal, re-attaching a turn after a runner or server restart, and runs of tasks (S5.2 and on): a dropped link ends
  a chat's turn today.
- A Claude login's access token that expires during a turn longer than its remaining hour: the server refreshes it only
  before the turn. Two Codex processes on one private folder at once (a turn and a terminal) share one `auth.json`: the
  later one writes its login over a token the first may have just refreshed (the server seals again what comes back).
- Codex takes no message mid-turn (`codex exec` reads its prompt once): Now is hidden for it. A Claude Code turn that
  takes a message after its result reports that result's usage as Claude Code counts it, and the parser's first-result
  bookkeeping (a background subagent still running becomes `interrupted`) is not redone for the extra turn.
- Approving a tool mid-turn (the permission tool): S6, over the same bridge. Until then `ask` refuses in chat and asks
  only in the terminal. Selections are built ("Asking the person"); the agent ends its turn after asking, and the answer
  is the next turn rather than a live reply.
- Running as root: Claude Code refuses `--dangerously-skip-permissions` as root, which matters for container runs.

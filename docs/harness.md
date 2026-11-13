# Harness drivers

How a runner turns one chat turn into a harness process and its output into events (S5.1a, 2026-11-09). The drivers
are pure: they build process specs and parse lines, and never spawn anything. The runner loads them (never the server):
it gets a turn with its credential over its link, asks the driver for the process spec, starts it in the agent's home
folder, feeds stdout to the driver's parser line by line and sends the events to the server. S5.1b runs them: chats with
an agent on its machine, each prompt one turn ("How a turn runs" below), and the chat's terminal on the same
conversation.

| Package                       | What                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `@mwc/shared/harness`         | the wire contracts (zod): `TurnSpec`, `TerminalSpec`, `HarnessCredential`, `HarnessGateway` (`harness/specs.ts`), `TurnEvent` and its limits (`harness/events.ts`), `contextWindowOf` and `contextPercent` (`harness/context.ts`), a reading's `RateLimits` (`harness/limits.ts`), the question tool's input and the answers (`harness/questions.ts`) |
| `@mwc/harness-core`           | the port: `HarnessDriver`, `ProcessSpec`, `PrivateDir`, `TurnTools`, `LineParser`, `HarnessError`, the shared checks and text helpers (`clipMarked` for long texts) |
| `@mwc/harness-core/fake`      | `FakeHarnessDriver`, the fake binary (`FAKE_HARNESS_BIN`, `runFakeHarness`), fake specs and credentials |
| `@mwc/harness-claude-code`    | `ClaudeCodeDriver` (`claude`), its parser; `/fixtures`: seven recorded-style turns             |
| `@mwc/harness-codex`          | `CodexDriver` (`codex`), its parser; `/fixtures`: eight recorded-style turns                  |

The server reads only `@mwc/shared/harness`; it never imports a harness package.

## The port

```ts
TurnSpec     { harness, cwd, prompt, sessionId: string|null, model: string|null, effort?, permissionPolicy: 'ask'|'bypass',
               permissionMode? /* the harness's mode, 2026-11-13 ("Modes"); absent: the one the policy meant */,
               configDir: string|null, credential: HarnessCredential, gateway: { baseUrl, headers } | null,
               forkSession?: boolean /* a branch's first turn: resume sessionId forked */,
               resumeAt?: string /* Claude Code: cut the forked copy after this message uuid */,
               instructions?: string /* standing instructions: the briefing, then the agent's own ("Standing instructions") */ }
TerminalSpec  the same without `prompt`

ProcessSpec  { command, args, env /* to add or override */, unsetEnv /* to remove */, stdin: string|null,
               stdinOpen? /* S5.2 step 6: stdin stays open for messages mid-turn */,
               privateDir?: { env?, path: string|null, files: { name, contents, mode, option? }[] },
               turnFiles?: { name, contents, mode }[] /* written in TurnTools.dir */, notices: TurnEvent<'notice'>[] }
TurnTools    { dir /* the turn's own folder, 0700 */, command, args /* <node> <runner.mjs> mcp */,
               names /* the MCP tools its server offers: ask_user_question, then the agents' tools (S6a) */,
               env /* MWC_ASK_SOCKET, MWC_ASK_TOKEN, MWC_TOOLS (the agents' tools, comma-joined, when any) */ }

HarnessDriver { harness; versionArgs; turn(TurnSpec, TurnTools?): ProcessSpec; terminal(TerminalSpec): ProcessSpec;
                parser(ParserContext?): LineParser; inputLine?(text, id): string /* a message mid-turn's stdin line */ }
ParserContext { privateDir?: string /* the turn's private folder: Codex's CODEX_HOME */ }
LineParser    { feed(line): TurnEvent[]; end(exitCode: number|null, stderrTail: string): TurnEvent[];
                settled?(): boolean /* every message taken answered: stdin may close */;
                tick?(): TurnEvent[] /* what the harness wrote elsewhere since the last tick */ }
PARSER_TICK_MS = 1000
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
  something (the harness's own last error, the end of stderr, the last stray line), cut to fit. A parser with `tick`
  follows what its harness writes outside its output (Codex's session files, "Codex subagents"): the runner calls it
  every `PARSER_TICK_MS` while the process runs, so its events come between lines and while the output is quiet, and
  never after `end`.

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
| `subagent`    | `id` (its Agent call's id), `agentType` (≤ 100), `description` (≤ 200), `model?`, `effort?` (≤ 50), `background?`, `status` (`running` \| `done` \| `failed` \| `interrupted`), `summary?` (≤ 4000, cut with the marker), `lastStep?` (≤ 200), `parentId?` | a subagent's whole state, each time it changes (the latest per `id` counts); Claude's Agent calls (`id` the call's), Codex's subagents (`id` the subagent's thread id, with its model and effort when Codex names them; see "Codex subagents") |
| `usage`       | `inputTokens`, `outputTokens`, `cachedInputTokens?`, `costUsd?` | the turn's sum; input counts cached tokens too; Claude adds its cache writes and reads |
| `context`     | `inputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `outputTokens`, `window` (null: unknown), `estimate?` (`true`), `usedTokens?`, `model?` (≤ 200), `baselineTokens?`, `rateLimits?` | the last request of the main agent; the conversation's size is `usedTokens` when the harness counts it itself, else `inputTokens + cacheReadTokens + cacheCreationTokens`; Claude's is exact, Codex's is its own reading from its session file (with the model it ran, its baseline and the plan's limits), or an `estimate` from the turn's total when that cannot be read (see "Codex's context reading") |
| `compact`     | `preTokens`, `postTokens` (null: not said), `trigger?` (`manual` \| `auto`) | a compaction of the conversation: Claude's `system/compact_boundary` |
| `notice`      | `level` (`info`, `warn`), `message` (≤ 2000), `parentId?` | a tool refused for permission, a retried request |
| `input`       | `text` (1–20 000), `inputId?` (the message's id, `turn.input`'s) | a message the person sent into the running turn, where the harness took it (S5.2 step 6): Claude Code's echo of it, kept by the runner only for a message it wrote |
| `result`      | `ok`, `text?` (the reply), `error?` (≤ 2000), `durationMs?`, `messageId?` (one word) | the last event of the harness's output; Claude Code's names the main agent's last message's `uuid`, where a branch from this reply resumes up to ("Branching") |
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
  stripped) and the OpenAI ones as Codex shows them, 95% of their `context_window` (GPT-6.1 475k, the rest of the GPT-6
  and the GPT-5 families 258.4k, `gpt-4.1` 1 047 576, `o3`, `o4-mini` and `codex-mini` 200k, `gpt-oss` 131 072);
  unknown models are null. Claude's `result.modelUsage[].contextWindow`, when it
  differs and is not smaller than what the conversation already holds, gives the last `context` again with it.
- **How full** is `contextPercent(used, window, baselineTokens)`: `used / window`, or with a baseline (Codex's 12k)
  `(used − baseline) / (window − baseline)`, which is how Codex's `/status` computes its "% left".
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
`CLAUDE_CODE_USE_BEDROCK|VERTEX|FOUNDRY` (an API key left in the machine's environment would win over the profile's
subscription); Codex's `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, `OPENAI_BASE_URL`.
`CLAUDE_CONFIG_DIR` is not removed since 2026-11-13: the machine's own value is where its Claude Code keeps its
conversations (`~/.claude` without one; the Docker runner's image sets a volume, docs/machines.md "The Docker runner's
volumes"), so turns, the chat terminal and a person's own `claude --resume` there use one store; a placement's
`configDir` still wins over it, and a login file in that folder never wins over the turn's credential variable.

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
                  [--resume <id>] [--model <m>] [--effort <e>] [<mode>]
                  the prompt as the first user message on stdin, which stays open
           with the runner's tools, after those:
                  --mcp-config <dir>/mcp.json --allowedTools mcp__mwc__ask_user_question[,mcp__mwc__<agent tool>…]
                  --append-system-prompt "When the person must choose between options, ask them with the
                  ask_user_question tool, then end your turn: their answer comes as their next message."
terminal:  claude [--resume <id>] [--model <m>] [--effort <e>] [<mode>]
mode:      Manual nothing · Accept edits, Plan, Auto --permission-mode acceptEdits|plan|auto
           · Skip prompts --dangerously-skip-permissions                                   ("Modes")
both:      with standing instructions, after those: --system-prompt-snapshot off
           and always, last:  --settings <runner state>/claude_code/<16 hex of sha256(cwd)>/settings-<12 hex>.json
           with standing instructions, then:  --append-system-prompt-file <same folder>/instructions-<12 hex>.md
           (the asking line then goes at the end of that file, not in --append-system-prompt)
env:       DISABLE_AUTOUPDATER=1; the credential's variable; CLAUDE_CONFIG_DIR=<configDir> when set (else the
           machine's own, kept); with a gateway
           ANTHROPIC_BASE_URL=<baseUrl> and ANTHROPIC_CUSTOM_HEADERS="Name: value" one per line
```

- **Standing instructions** (2026-11-11, "Standing instructions" below): a private file named by
  `--append-system-prompt-file`, and `--system-prompt-snapshot off` (`instructions.ts`).
- **A branch's first turn** (2026-11-10, "Branching"): `--fork-session` after `--resume <id>`, and
  `--resume-session-at <uuid>` when the spec says `resumeAt` (`forkArgs`); never in the terminal.

- **No auto-update** (2026-11-10). Every turn and terminal gets `DISABLE_AUTOUPDATER=1` (`NO_AUTO_UPDATE`; the name is
  in Claude Code 2.1.322's own list of the variables it reads), so Claude Code never updates itself mid-run or offers
  to; a machine's CLIs are updated from its card (docs/machines.md "Tools").

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
- **The mode** (`modeArgs`, "Modes" below). In `-p` there is no one to ask, so a tool the mode does not allow is refused,
  the model is told, and the `result`'s `permission_denials` become `warn` notices (`Refused for permission: Bash (rm
  -rf build)`), whatever the mode (Accept edits and Auto too). In the terminal Claude Code asks the person on the TUI.
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
turn, new:      codex exec --json --skip-git-repo-check -c check_for_update_on_startup=false [--model <m>] [-c model_reasoning_effort="<e>"] <permissions>
                [<tools>] -
turn, resume:   codex exec resume --json --skip-git-repo-check -c check_for_update_on_startup=false [--model <m>] [-c …] <permissions> [<tools>] <threadId> -
turn, fork:     codex exec fork … the same options … <threadId> -     (a branch's first turn, "Branching")
tools:          -c mcp_servers.mwc.command="<node>" -c mcp_servers.mwc.args=["<runner.mjs>","mcp"]
                -c mcp_servers.mwc.env_vars=["MWC_ASK_SOCKET","MWC_ASK_TOKEN"(,"MWC_TOOLS" with agents' tools, S6a)]
                -c mcp_servers.mwc.default_tools_approval_mode="approve"     and both variables in codex's env
terminal:       codex [resume] -c check_for_update_on_startup=false [--model <m>] [-c …] <permissions> [<threadId>]
permissions:    Full trust  --dangerously-bypass-approvals-and-sandbox
                Auto        turn: -c sandbox_mode="workspace-write" -c approval_policy="never"
                            terminal: --sandbox workspace-write --ask-for-approval on-request
                Ask         turn: -c sandbox_mode="read-only" -c approval_policy="never"
                            terminal: --sandbox read-only --ask-for-approval on-request      ("Modes")
provider:       gateway   -c model_provider="mwc_gateway" -c model_providers.mwc_gateway.name="Most Wanted gateway"
                          -c model_providers.mwc_gateway.base_url="<baseUrl>"
                          -c model_providers.mwc_gateway.wire_api="responses"
                          -c model_providers.mwc_gateway.requires_openai_auth=true     (a login; a key in the TUI)
                       or -c model_providers.mwc_gateway.env_key="CODEX_API_KEY"         (a key in codex exec)
                          [-c model_providers.mwc_gateway.env_http_headers={ "<name>" = "MWC_GATEWAY_SECRET_HEADER_<n>", … }]
                none      -c model_provider="openai"
                after the permissions, before the tools (turn: … <permissions> <provider> [<tools>] [<threadId>] -)
home:           privateDir CODEX_HOME = configDir, or the runner's own folder for this cwd
instructions:   with standing instructions, <CODEX_HOME>/AGENTS.override.md (0600, while the process runs); no argument
```

- **Why `-c` for the turn's sandbox.** `codex exec resume` has no `--sandbox`; the config overrides work for both
  forms. With approvals off, what the workspace-write sandbox does not allow fails and the model is told; a command
  Codex reports `declined` gives a `warn` notice.
- **No update check** (2026-11-10). `check_for_update_on_startup=false` (`NO_UPDATE_CHECK`, a top-level key of
  Codex's `ConfigToml`, found in Codex 0.162.1's binary) keeps the TUI's "Update available … Update now" prompt and
  the startup check out of turns and terminals; a machine's CLIs are updated from its card (docs/machines.md "Tools").
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
  (0) after `turn.completed` gives `result` ok with the last agent message. A `collab_tool_call` item gives `subagent`
  events ("Codex subagents" below); a subagent's own work never reaches the stream, so its events (with its thread id
  as their `parentId`) and multi-agent v2's subagents come from the session files, on the parser's `tick`.
- **Context and cost** (checked in Codex 0.167.0's binary, 2026-11-10: the exec stream's events are `thread.started
  {thread_id}`, `turn.started`, `turn.completed {usage}`, `turn.failed`, `item.*` and `error`; the usage is
  `input_tokens` (cached ones included), `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`). `turn.completed`'s usage is the turn's sum over its model calls (each command or tool call
  is another request), so it gives the `usage` event only; the turn's `context` is Codex's own reading, read when the
  turn ends ("Codex's context reading" below). Only when that cannot be read (no session file, no reading in it yet, an
  older runner) does `turn.completed`'s usage give a `context` with `estimate: true` at the turn's end: `inputTokens` =
  input − cached, `cacheReadTokens` = cached, `cacheCreationTokens` 0, `window` null (the server takes the model table's
  window for the access profile's model; the meter too). The meter shows "≈" before such a size and says so in its
  popover, and names the profile's model or "Codex's default" until a reading names the model.
  Codex gives no cost: a turn on a login (`codex_oauth`, and Claude's `claude_oauth` and `claude_setup_token`) keeps
  `includedInPlan: true` in its stored usage (`endedTurn`), and the popover and the turn's footer say "included in your
  plan" instead of a dash or $0.00; only API keys and gateways show money, when the harness gives it.

### Codex's context reading

Built 2026-11-10 (Ihor: the meter read "≈249k / 272k · 92%" after one turn of 5 commands and 3 web searches, while
Codex's `/status` said "35.9K used / 475K", 95% left). Codex writes a session file per thread in its home folder,
`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl` (the day the thread began; `codex exec resume` and
the TUI's `resume` append to it, checked on a runner's own folder; `codex exec fork` starts a new thread and file). Each
line is `{timestamp, ordinal, type, payload}`:

- `event_msg` with `payload.type` `token_count`, after each model request: `payload.info` (null on some lines) has
  `last_token_usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`, `total_tokens`), `total_token_usage` (the thread's sum) and `model_context_window`, the
  window Codex shows (its catalogue's `context_window` × `effective_context_window_percent`, 95: 475 000 for GPT-6.1 Sol
  and Terra, 258 400 for the other current models); `payload.rate_limits` has `primary` and `secondary` (`used_percent`,
  `window_minutes`, `resets_at` in Unix seconds), `plan_type` and more (all null through a gateway).
- `turn_context`, at each turn's start: `payload.model` (the model Codex really ran, also when the profile names none)
  and `payload.effort`.

When a Codex turn ends, cleanly or not, its parser (`connectors/harness-codex/src/parser.ts`) asks the driver's reader
(`rollout.ts`, `reading.ts`) for the thread's reading in the turn's `CODEX_HOME` (the private folder the runner leased,
`ParserContext.privateDir`): it finds the file by the thread id of `thread.started` (day folders newest first), reads it
from its end (1 MiB, then four times more up to 16 MiB until the `turn_context` is in; the first, cut line dropped; only
lines naming `token_count` or `turn_context` are parsed) and takes the last `token_count` with `info`, with the model of
the last `turn_context` before it. Synchronous file calls only (the runner's `PrivateFs`: `list`, `tail`), no process.
The `context` event it gives is exact: `usedTokens` = `last_token_usage.total_tokens` (input and output of the last
request: what `/status` calls used, "35.9K"), `window` = `model_context_window`, `model`, `inputTokens` = input − cached
− cache writes, `cacheReadTokens`, `cacheCreationTokens`, `outputTokens`, `baselineTokens` 12 000 and, when Codex gave
them, `rateLimits` (`{primary?, secondary?: {usedPercent, windowMinutes?, resetsAt?}, planType?}`, optional data that
nothing shows yet). Codex's "% left" leaves out a fixed 12 000-token baseline (instructions and tools, its
`BASELINE_TOKENS`): 35 865 of 475 000 is 95% left by its rule and 92% without it, so the meter computes its share with
`contextPercent` and the baseline. The server reads the last `context` as before (`conversationState`: `usedTokens` and
the event's `model` when given), so a new turn's exact reading replaces an older turn's estimate, and stored estimates
keep their "≈". A machine reads it only once its runner is updated; until then its Codex turns keep the estimate.

### Codex subagents

Built 2026-11-10 (Ihor asked a Codex chat for three subagents on different models, each running a 30–60 s script; the
reply said "I'll spawn three sub-agents…" and the turn showed "Writing the reply… No actions yet": the collab items were
dropped). Checked against Codex's source (`codex-rs/exec/src/exec_events.rs`, `event_processor_with_jsonl_output.rs`,
its JSON test `collab_spawn_begin_and_end_emit_item_events`, and `lib.rs`):

- **The stream.** Subagent work is `item.started` / `item.completed` of `{ id, type: "collab_tool_call", tool,
  sender_thread_id, receiver_thread_ids, prompt (string or null), agents_states: { <thread id>: { status, message } },
  status }`, `tool` one of `spawn_agent`, `send_input`, `wait` (also Codex's `resume_agent`), `close_agent`
  (Codex's `send_message`, `followup_task`, `interrupt_agent` and `list_agents` are not written, nor an interrupted
  call), `status` `in_progress`, `completed` or `failed`, an agent's `status` `pending_init`, `running`,
  `interrupted`, `completed`, `errored`, `shutdown` or `not_found`. A spawn starts with no thread
  (`receiver_thread_ids: []`) and names it when it completes. Codex's app-server event carries the child's `model` and
  `reasoning_effort`, but `codex exec` drops them, and it writes only the primary thread's notifications
  (`should_process_notification`): a subagent's own commands, messages and usage never reach the parent's stream.
- **The mapping** (`connectors/harness-codex/src/subagents.ts`). Each thread a completed `spawn_agent` names is a
  `subagent` with that thread id as its `id`: `agentType` "Codex agent", `description` the first non-empty line of the
  `prompt` (one line, ≤ 200), `background: true` (it works on its own until the agent `wait`s for it), `status` from its
  state (`running` until then), or `failed` when the spawn failed. Every collab call's `agents_states` then moves a
  running subagent: `completed` → `done`, `errored` or `not_found` → `failed`, `interrupted` or `shutdown` →
  `interrupted` (`pending_init` and `running` stay `running`), its `message` (cut with the marker at 4000) as its
  `summary`; one that ended stays as it ended, and threads no spawn of this turn named are ignored. A failed call that
  names no subagent (a spawn that made none, a failed `wait`, `send_input` or `close_agent`) is a `tool` named after the
  call (the prompt's first line as its summary) with a failed `tool_result` ("Codex could not spawn agent."); the other
  calls give no line of their own. Those still running when the turn ends (`turn.failed`, or the process's end) become
  `interrupted` before its `result`, as Claude's do.
- **Its model, role and last command.** Each subagent writes its own session file in the same home folder,
  `rollout-<time>-<its thread id>.jsonl` (`session_meta` with `source.subagent.thread_spawn` and its `agent_role`, a
  `turn_context` per turn with its `model`, an `event_msg` `item_completed` of a `CommandExecution` per command, with
  its argv; older Codex wrote `exec_command_end`). When a subagent ends, or the turn ends, the parser reads that file
  once (`children.ts`: the same finder as the context reading, one 1 MiB read from the end, only lines naming
  `session_meta`, `turn_context`, `CommandExecution` or `exec_command_end` parsed) and adds `model` (its last
  `turn_context`), `agentType` "Codex <role>" for a role other than `default` (an `explorer`, a `worker`, a custom
  agent), and `lastStep` "Ran <command>" (the script of a `zsh -lc '…'`, else the argv joined). A missing or unreadable
  file adds nothing. While a subagent runs, its own file is followed for its commands and messages (below); without
  them (an older runner, a file not found) the web shows "Working…" for it, and once it ends the model chip, its answer
  and its last step ("Last step: Ran …" where a Claude subagent would show its step count).

#### v1 and v2: where each comes from

Built 2026-11-10, the same evening (Ihor asked again: Codex 0.167.0 on his devbox, GPT-6.1-Sol, three subagents on
different models each sleeping 30–60 s; Codex's own TUI showed "Started `/root/sleep_sol`" and later "Completed", our
chat only the first message and "Writing the reply…"; the server held one `session` and one `text` event). Checked
against Codex 0.167.0's source (`rust-v0.167.0`: `core/src/tools/handlers/multi_agents_v2.rs` and `…/spawn.rs`,
`core/src/agent/control/completion.rs`, `protocol/src/items.rs`, `protocol/src/protocol.rs`,
`protocol/src/legacy_events.rs`, `protocol/src/agent_path.rs`, `rollout/src/policy.rs`, `history/src/rollout_payload.rs`,
`exec/src/event_processor_with_jsonl_output.rs`, `tui/src/multi_agents.rs`), and against the key names and line types
of Codex 0.160–0.166 session files on a Mac (structure only; none of them had a v2 subagent):

- **Multi-agent v1** (the collab tools above) reports subagents as `CollabAgentToolCall` items, which `codex exec --json`
  prints as `collab_tool_call`. **Multi-agent v2** (tools `spawn_agent`, `send_message`, `followup_task`,
  `wait_agent`, `interrupt_agent`, `list_agents` in the `collaboration` namespace; agents addressed by path,
  `/root/<task_name>`) still builds collab items, but only for analytics (`tui/src/multi_agents.rs`: "V2 uses
  SubAgentActivity for display; these variants are analytics-only"); what it shows is a `SubAgentActivity` item, which
  the exec JSON processor drops (`_ => None`). So under v2 `codex exec --json` carries nothing of the subagents, and
  the parser reads Codex's own session files instead, while the turn runs.
- **The agent's file** (`rollout.ts`'s finder, by the `thread.started` thread id). A v2 activity is
  `SubAgentActivityItem { id, kind: started | interacted | interrupted | completed, agent_thread_id, agent_path, model,
  reasoning_effort }` (`model` and `reasoning_effort` resolved at the spawn, null otherwise). Each is emitted as an item
  started and completed; the file keeps, by the thread's `history_mode` (`session_meta`), an `event_msg`
  `{ type: "sub_agent_activity", event_id, occurred_at_ms, agent_thread_id, agent_path, kind, model, reasoning_effort }`
  (legacy: every kind but `completed`) or an `event_msg` `{ type: "item_completed", thread_id, turn_id, item: { type:
  "SubAgentActivity", … }, completed_at_ms }` (paginated: every kind; legacy: `completed`). `started` comes from the
  spawn with the call's id as its `id`; `completed` from the child's terminal turn when it completed (an errored child
  sends none; its own file says so); `interacted` from `send_message` / `followup_task`; `interrupted` from
  `interrupt_agent`. The spawn's own call is a `response_item` `{ type: "function_call", name: "spawn_agent",
  namespace: "collaboration", arguments: "<JSON>", call_id }`, its arguments `{ task_name, message, agent_type?,
  model?, reasoning_effort?, fork_turns? }`.
- **A subagent's own file** (`rollout-<time>-<agent_thread_id>.jsonl`, in the same home folder): `session_meta` (its
  `source.subagent.thread_spawn` with `parent_thread_id`, `agent_path`, its `history_mode`), then, by default
  (`fork_turns: "all"`), the parent's history copied in (`core/src/agent/history.rs`: its event messages, the running
  turn's `task_started` and messages included; its calls too with `preserve_fork_prefix`), then its own turns:
  `event_msg` `task_started { turn_id, root_turn_id, started_at }` (Unix seconds; `root_turn_id` equals `turn_id` only
  in the root thread, confirmed on disk), `turn_context { model, effort }`, a command's call as a `response_item` `function_call`
  (`exec_command` with `cmd`; `shell` / `container.exec` with an argv `command`; `shell_command` with a line;
  `local_shell_call`), its end as `item_completed` of a `CommandExecution { id (the call's), command (argv), status,
  exit_code, aggregated_output (cut to 64 KiB) }` (paginated; also for a command code mode ran; legacy files keep only
  the call's `function_call_output`, since `exec_command_end` is not persisted), its messages as `item_completed`
  `AgentMessage { content: [{ type: "Text", text }] }` (paginated) or `agent_message { message }` (legacy), and
  `task_complete { last_agent_message, error? }` at each turn's end.
- **Following** (`connectors/harness-codex/src/follow/`; the runner calls the parser's `tick` every second while the
  process runs, and the turn's end reads once more). `file.ts` reads a file from a byte offset with one open and one
  read (`RolloutFs.readAt`, Node's `openSync`/`readSync` in the runner), keeps only whole lines (a line still being
  written waits for the next poll) and skips a line over 1 MiB. Only lines naming a marker are parsed. The agent's file,
  when it is there at `thread.started` (a resumed thread, a fork), is followed from its end; one that appears later is
  looked for in the newest two day folders and read from its start. Lines count only after a `task_started` of this
  turn (`started_at` no earlier than the second the runner made the parser) and, in a subagent's file, of its own (not
  a root turn: `root_turn_id` ≠ `turn_id`), so a resumed or forked thread's history and the parent turns copied into a
  subagent's file, the running one too, never show. Bounds: 1 MiB per file and 4 MiB in all per poll (the
  agent's first, the rest waits for the next poll), 16 subagents' files, a subagent's file looked for during 30 polls,
  200 commands and messages shown per subagent, 64 spawn calls kept. No process starts.
- **The mapping** (`follow/parent.ts`, `follow/live.ts`). A `started` (or `interacted`) activity for a thread not seen
  yet is a `subagent` with the thread id as its `id`, `agentType` its path under the root (`/root/sleep_sol` →
  `sleep_sol`), `description` the first non-empty line of the spawn call's `message` (filled when the call comes after
  the activity), `model` and `effort` from the activity (else the call's arguments), `background: true`, `running`.
  `interacted` → `running`, `completed` → `done`, `interrupted` → `interrupted`; a `completed` or `interrupted` of a
  thread this turn never started (an earlier turn's subagent) is ignored. Every subagent, v1's collab ones too, has its
  own file followed (`follow/child.ts`, `follow/steps.ts`): a command is a `tool` named `command` (the call's `cmd`, or
  the script of `bash -lc '…'`) with the subagent as `parentId` and `<thread id>:<call id>` as its id, its end a
  `tool_result` (`exit <code>: <the end of its output>`, as the stream's commands; a legacy output by its "Process
  exited with code N" or "Exit code: N", none while "Process running with session ID"), a message a `text`; its turn's
  `task_complete` gives the subagent's `summary` (its last message, or its error), and moves a v2 subagent still
  `running` to `done` (or `failed` with an error). A v2 subagent is not read again when the turn ends (its file was
  followed). Those still running when the turn ends become `interrupted`, after the last read.
- **One subagent per thread.** v1's collab items and v2's activities write into one state keyed by the thread id: a
  thread both report is one block, an activity only moving its status and adding the model and effort it lacked.
- **The web** shows them as Claude's: the block's chip "gpt-6.1-sol · high", its nested commands and messages under it
  (opened), "N steps" once folded, its answer as the Result; the status line names the subagent doing the latest step
  ("sleep_sol · Running `sleep 45`"), and "Waiting for N agents…" when the main agent's last event is a message or a
  subagent's end while others still run (instead of "Writing the reply…"). After a reload the stored events give the
  same thread.

## Modes

Built 2026-11-13 (Ihor: "I would love to set it in the PROFILE, with an ability to change in the CHAT"; the profile's
side is docs/subscriptions.md "Mode"). A turn and a terminal run in a **mode**: the chat's own (a message chat's
override) when it has one that fits, else its profile's AI part's.

**On the command line** (verified with `claude --help` 2.1.323, `codex --help` and `codex exec --help` 0.167.0; no
session was run):

| Harness | Mode | Turn (`-p` / `codex exec`) | Terminal (the TUI) |
| --- | --- | --- | --- |
| Claude Code | Manual (`manual`) | nothing: Claude Code's own default, as the old `ask` (an older CLI without `manual` runs it too) | the same |
| | Accept edits (`acceptEdits`) | `--permission-mode acceptEdits` | the same |
| | Plan (`plan`) | `--permission-mode plan`: the turn explores and writes a plan; anything that would change something is refused | the same |
| | Auto (`auto`) | `--permission-mode auto` | the same |
| | Skip prompts (`bypassPermissions`) | `--dangerously-skip-permissions`, as the old `bypass` | the same |
| Codex | Ask (`ask`) | `-c sandbox_mode="read-only" -c approval_policy="never"` | `--sandbox read-only --ask-for-approval on-request` |
| | Auto (`auto`) | `-c sandbox_mode="workspace-write" -c approval_policy="never"` (the old `ask`) | `--sandbox workspace-write --ask-for-approval on-request` |
| | Full trust (`full`) | `--dangerously-bypass-approvals-and-sandbox` | the same |

`claude --help` 2.1.323 lists `--permission-mode` with `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`,
`plan`; Codex 0.167.0's `--sandbox` takes `read-only`, `workspace-write`, `danger-full-access` and `--ask-for-approval`
`on-request` and `never` (the TUI and `codex exec`; `codex exec` and `exec resume` take no `--ask-for-approval`, and
`exec resume` no `--sandbox`, so a turn says both as config overrides). In a turn nobody answers a prompt: whatever the
mode does not allow is refused and the model is told; Claude Code's `permission_denials` and Codex's declined commands
become `warn` notices in the thread, for every mode (Accept edits and Auto relay the prompts they still raise the same
way). Approving one live (the permission tool) is still to come ("Not supported yet").

**On the wire.** `TurnSpec.permissionMode` (and `TerminalSpec`'s) carries the mode; `permissionPolicy` stays beside it
for a runner older than the modes: `bypass` for Skip prompts and Full trust, `ask` for the rest (`policyOfMode`). Such a
runner runs every other mode as `ask` (Manual on Claude Code, the old workspace-write sandbox on Codex) until it is
updated. A driver reads the spec's mode, else the one an older server's policy meant (`specMode`, `modeOfPolicy`: `ask`
is Manual on Claude Code and Auto on Codex), and refuses a mode of the other harness (`invalid_spec`).

**The chat's own mode, model and effort** (the overrides; `chats.mode`, `model`, `effort`, each null for the profile's):

- `PATCH /api/companies/:companyId/chats/:chatId/overrides` `{ mode?, model?, effort? }` (admins and owners, as sending a
  message; a value sets, null clears, a field left out is kept; at least one) → the chat with `overrides`. Refusals: 404
  `chat_not_found`; 409 `chat_archived`, and `overrides_unsupported` for a task's conversation or a flow's team chat;
  422 `mode_unsupported` (a mode of the other harness), `model_unsupported` (not one of the chat's provider's catalogue
  models: no typed-in ids), `effort_unsupported` (an effort the model it then runs, the chat's else the profile's, does
  not take). Audited with the chat (`mode`, `model`, `effort`).
- Taken at any time, a turn running or not: a running turn keeps what it started with, the next one (a waiting message
  too, when it starts) takes them.
- Message chats only: a task step's turns (and a person's reply in a task's conversation), a Lead's wake-ups and team
  room turns run on the profile's, whatever the row says.
- A turn runs `chatRuns` (`@mwc/shared/modes`): each override that fits the chat's AI, else the profile's; the effort
  the chat's when the model it runs takes it, else the profile's when it does, else the default.
- When the chat's profile becomes one of another AI than its harness's (Claude ↔ OpenAI: the chat back on its agent's
  profile after the agent moved to the other AI), its overrides are cleared in the same change, audited. A turn never
  takes an override of another provider anyway.
- The chat shows `overrides` (lists and detail); the detail shows `profileRuns` (`{mode, model, effort}` of the profile it
  runs on, for its harness), which the menus name as "Profile's (…)".

**What a turn records**: `chat_turns.mode`, `model` and `effort`, what its spec carried when it started (the model and
effort null for the harness's default; all null before 2026-11-13, for a Clear and for a turn that has not started).
The turn's view has them, and the thread's footer reads them ("Plan · Sonnet 5.5 · Low").

**The web**: the composer's footer has a **Mode** menu (the current mode; "Profile's (Manual)" first, checked while the
chat has none of its own, then each mode with its line, as Claude's own mode menu) and a **Model** menu (the profile's,
then the provider's catalogue, with Effort as a sub-choice listing the levels the model takes); each has **Reset to
profile** once the chat overrides it, and a pill turns blue while it does. Choosing a model the chat's effort does not
fit clears that effort. The full chat and the rail's docked chat both have them, opening upward; they show in message
chats while the composer is open. The Profiles page's AI part has the **Mode** control.

Since 2026-11-13 (Ihor: the footer "100% requires redesign") the composer's footer is one row that never wraps: the
microphone, the Mode pill (an icon per mode and its short label: Ask, Edits, Plan, Auto, Full trust) and the Model pill
("Opus 5.5 · X-high", the effort muted) on the left; the context ring (a 20 px donut, green, amber past 70% and red
past 90%, "Context 20k / 1M · 2% used" in its tooltip, its popover on a click, Compact beside it past 70%), Stop and
Send on the right. The card is a CSS container: the effort shows from 32rem, the ring's share and Compact's word from
28rem, the Mode's word and the pills' arrows from 24rem. No keyboard hint. The design gallery's Composer section shows
it at the full chat's, a phone's and the docked chat's widths.

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
   proper), its machine's runner connected (a stopped machine may be started and waited for: "When the machine is
   stopped"), newer than chats (`caps.harnesses` with versions) and with the harness's
   CLI; the profile (the chat's, else the agent's), with the part the harness runs on (Claude Code: a Claude part;
   Codex: an OpenAI part; else `profile_part_missing`), with its gateway (its address with the route's path, by
   the harness and the credential's kind), and its subscription (`profile_empty`
   when it has none). The spec's model and effort are that profile's (since 2026-11-10; docs/subscriptions.md "Model
   and effort"), and its mode too (since 2026-11-13), each the chat's own instead in a message chat that sets one
   ("Modes"): none for the provider's default, and Codex's old marker `codex-default`, a Claude id on Codex or an
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
4. **The standing instructions** (2026-11-11): the agent's briefing, read from the live chart now, then its own
   instructions, go in the spec's `instructions` ("Standing instructions"), for a terminal too.
5. **The turn** is recorded `running` (with the profile and credential it runs on, and the mode, model and effort; the first prompt is the chat's title,
   80 characters), its sink is put in place, and `turn.start {turnId, spec}` goes to the runner. The answer is 202 with
   the turn.
6. **The runner** (`turns/turns.ts`, `turn.ts`) refuses at once with `turn.end {ok: false, exitCode: null, error}`
   what it cannot run: `unsupported` (no such CLI, even after searching again, or no way to start processes), `busy` (all `slots` live; the server lets the turn wait for a free slot instead, "Waiting for a free slot"), `home_missing`
   (the agent's folder is not there; a container runner makes a missing one under its work volume first, below), `invalid_spec: …` (the driver refused the spec), `spawn_failed: …`,
   `runner_stopping`. **A missing home folder** (2026-11-13, Ihor, after TEST DEV's first message on the Docker runner
   failed: "Does it mean it should be created?!"): a container runner makes the agent's home folder before the turn when
   it is under the work volume, `/work` (`HarnessHost.makeHome`, `fs.mkdirp`'s rules in docs/runner-protocol.md
   "Folders": no `..` above it, no link out of it, 0755, logged); it is a new agent's fresh folder. A turn stopped
   meanwhile is not started. On any other machine, and when it cannot be made, the turn is still refused with
   `home_missing`; the chat's failure then offers admins and owners **Create folder** (`POST …/folders` with `parents`,
   docs/machines.md "The folder browser"), then **Send again**, which sends the turn's prompt once more. Otherwise it
   makes the turn's run folder and starts the turn's **keeper** (`node runner.mjs keep`,
   detached: its own session and process group; "Surviving restarts" below), which starts the driver's command with no
   shell in the agent's folder, with the runner's environment less `MWC_*` and the driver's `unsetEnv`, plus `env` and the
   private folder's variable, its stdout and stderr appended to files in the run folder. The prompt goes to the harness's
   stdin through the keeper, which closes it after (Claude Code's turns keep it open for the person's messages until
   their result, "Delivery while a turn runs"); the driver's notices are the first events. The runner reads the stdout
   file every 100 ms (`JOURNAL_POLL_MS`) line by line into the driver's parser (and asks a parser with `tick` every
   second, "The port"); a failure quotes the last 4 KB of the stderr file. Events go as `turn.events` about 100 ms after
   the first, or at once from 32 KB or 100 events, numbered from 1 and each kept in the run folder before it is sent; a
   text event over 16 KB is split, a result's text cut to fit. When the keeper ends, `parser.end` gives the last events,
   then `turn.end {ok, exitCode, error?, authJson?}`: `ok` is the result's, `exitCode` the harness's (null after a
   signal), `error` is `stopped` after `turn.stop` (SIGINT to the group, SIGTERM 10 s later, SIGKILL 20 s after the
   SIGINT), `spawn_failed: …` when the harness could not start, `process_lost` when the keeper ended without the exit
   recorded, or `session_missing: <the harness's line>` when the conversation it resumed is not on the machine (no
   failing result then: "A lost conversation"). The server answers `turn.ack` once it recorded the end, and the run folder goes. Live turns hold the machine
   as live runs do; since S5.4 they no longer make the self-update say `busy` (they outlive the restart).
7. **The private folder** (`turns/private-dir.ts`): Codex's is the placement's `configDir` when it has one, else
   `<runner state dir>/<harness>/<first 16 hex of sha256(home)>/`, never the machine's `~/.codex`; Claude Code's is always
   the runner's own (`<state>/claude_code/<16 hex>/`), never `CLAUDE_CONFIG_DIR` (Claude Code's conversations stay in
   the machine's own store: `CLAUDE_CONFIG_DIR` when the machine sets one, else `~/.claude`); made 0700. `auth.json` and Claude
   Code's `settings-<12 hex>.json` are written 0600 before the process (a marker file first; a file of that name the
   runner did not write is set aside and put back), the settings file named on the command line (`--settings <path>`,
   `withPrivateDir`), and removed when the last process using the folder ends (since S5.4, when its turn's end is sent:
   a turn whose end waits for its link keeps them until then, and a runner that takes it back adopts them). When the process rewrote it (its own token
   refresh), the new text goes back in `turn.end.authJson` (a terminal's in `terminal.exit.authJson`) and the server
   seals it into the credential again; the browser never sees it.
8. **The server** stores each event (`chat_events`, a resend kept once), saves the chat's `session_id` from the
   `session` event (the next turn resumes it), tells the chat's stream listeners, and on `turn.end` closes the turn:
   `done`, `failed` (the runner's reason first, else the result's error) or `stopped`, with the result's text and the
   usage. Since S5.4 a turn outlives its runner's link and the server: a runner that keeps turns (`caps.reattach`) and
   whose link drops leaves them running and the server keeps them `running` and detached for the grace
   (`MWC_TURN_GRACE_SECONDS`, 30 minutes since 2026-11-12); the runner's next hello takes them back, and at the server's
   start the turns left running wait the same grace for their runner. Only when the grace runs out do they fail
   (`machine_disconnected: <the machine> was unreachable for 30 minutes: the turn stopped.`, `server_restarted`), and a
   runner that comes back later still gets them back while nothing else ran in their chat; an older runner's dropped link
   fails them at once, as before ("Surviving restarts").
9. **The stream** (`GET …/chats/{chatId}/stream`, members and above): Server-Sent Events over an authenticated GET
   (the web reads it with `fetch` and its Bearer header): `turn` (`{turn}`) on a start and each status change, `event`
   (`{turnId, turnSeq, seq, event, at}`, its `id:` `<turnSeq>.<seq>`), a `: heartbeat` comment every 20 s;
   `Last-Event-ID` replays the turns from that turn on and the events after it, then the live ones, never one twice.
10. **The terminal** (`POST …/chats/{chatId}/terminal-tickets`, owners only): the same checks and credential, then the
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

## Surviving restarts

Built in S5.4 (2026-11-11; the roadmap's "Done when": `kill -9` of the runner and a server restart mid-turn both
recover). A running turn survives `kill -9` of its runner (the harness keeps running and the restarted runner takes it
back), a server restart (the runner keeps the turn going and the restarted server takes it back), and a dropped link that
comes back. Events missed meanwhile are delivered once, never twice; Stop works on a turn taken back; a turn whose process
really died ends honestly. Task step turns and chat turns behave the same, and so does the task state.

**Link drops** (2026-11-12, after a blip of This Mac's network kept the devbox's tunnel down for 8 minutes: the 180 s
grace then failed two turns the runner kept alive, and its hello stopped them). A real network outage is now survived
too: the grace is 30 minutes; a turn that still fails names its machine and how long; a runner that comes back even
later gets its turn back while nothing else ran in its chat (a late re-attach, below); and the box's tunnel comes back
within about 30 s of the network (docs/machines.md, "The standing tunnel"). The runner needed no change: it keeps a turn,
its process and its numbered events however long its link is down (only `KEEPER_ORPHAN_MS` closes stdin, when no runner
at all is on the keeper's line for 10 minutes), and reconnects every 60 s at most.

**The run folder** (`apps/runner/src/turns/runs/folder.ts`): `<runner state>/runs/<first 12 hex of sha256(turn id)>/`,
made 0700 when the turn starts, and removed when the server acknowledges its end (`turn.ack`), when the server no
longer has the turn, or 24 hours after it ended (`RUN_RETENTION_MS`, looked at when a runner starts).

| File | Who writes it | What |
| ---- | ------------- | ---- |
| `meta.json` (0600) | the runner, when the keeper started (again when a stop begins) | `{v, turnId, harness, cwd, pid (the keeper's, its process group's), startedAt, stdinOpen, privateDir: {path, files: [{name, sha256}], aside} \| null, artifacts: {root, before: [[path, "size:mtime"]]} \| null, ask: {dir, tokenSha256} \| null, stopping?}`. Never a credential, a token or an environment value: the private files are named with their SHA-256, the question socket's token only by its SHA-256. |
| `out`, `err` | the keeper (appended) | the harness's stdout (the journal the runner reads) and stderr |
| `events.jsonl` (0600) | the runner | every event it numbered, before it is sent: `{s, o, e}` (its number, how far into `out` the runner had read, the event), a question as `{s, o, q: {questionId, questions}}`, and `{fin: true, o}` once the output was read to its end and the parser's last events kept |
| `inputs.jsonl` (0600) | the runner | each message written into the turn (`{id, text}`) and `{end: true}` once stdin closed |
| `exit.json` (0600) | the keeper | `{code, signal}` when the harness ended, or `{code: null, signal: null, error}` when it could not start |
| `k.sock` | the keeper | its control socket while it runs |

**The keeper** (`turns/runs/keeper.ts`): `node runner.mjs keep <run folder> -- <command> <args…>`, the one process the
runner starts per turn (the Mac bills each process start; this is the only extra one), detached: its own session and
process group, with the harness's environment and folder. It starts the harness in its group with stdin piped and stdout
and stderr on the run folder's files (not pipes, so the harness never notices the runner going away), writes `exit.json`
when the harness exits, then exits. SIGINT, SIGTERM and SIGHUP do not end it (the stop ladder signals the whole group, so
the harness gets them; SIGKILL ends both). A Node keeper rather than a shell wrapper because it gives the exact exit (code
or signal), holds the harness's stdin across runner restarts, and proves its identity through its socket (below).

**Stdin.** The keeper holds the harness's stdin. The runner that started it writes commands on the keeper's own stdin; a
runner that took the turn back connects to `k.sock` (greeted with `{"pid":N}`) and writes the same commands, one JSON line
each: `{"w":"<text>"}` writes the text, `{"end":true}` closes the harness's stdin. A runner that goes away closes its line
without `end`, so stdin stays open: **Now deliveries keep working on a turn taken back** (Claude Code's input mode: the
prompt first, then each `turn.input` line, closed after a settled result, as before). The messages written and the close
are in `inputs.jsonl`, so a runner taking the turn back keeps their echoes and knows whether stdin is still open. When no
runner has been on the line for 10 minutes (`KEEPER_ORPHAN_MS`), the keeper closes stdin itself, so a harness waiting for
more messages finishes rather than waiting forever for a runner that never comes. Codex reads its prompt and the keeper
closes its stdin at once (`{"end":true}` right after the prompt).

**Reading the journal** (`turns/runs/journal.ts`, `turn/output.ts`): every 100 ms the runner reads `out` from its offset
with one open and one read (no process, no watcher), splits it on newline bytes, and feeds whole lines to the parser; a
line still being written waits. Each event is appended to `events.jsonl` with the offset just after its line before it is
sent (`turn/events.ts`), so the log is the turn's truth: a runner taking the turn back reads the journal again from its
start up to the log's last offset through a new parser (its state rebuilt, nothing numbered), goes on numbering after the
log's last event, and parses only what follows. A Codex turn's parser gets the turn's own start (`ParserContext.startedAt`)
so its session-file follower still knows this turn's lines; the follower goes on from the files' end (subagent steps
written while nobody read them are not shown).

**Taking a turn back** (`turns/runs/reattach.ts`, `prepare.ts`): when a runner starts, before its first hello, it looks at
every run folder. One without a meta goes. One with `exit.json` ended: it is taken back to deliver its last events and end.
Otherwise the runner connects to `k.sock`: a keeper that answers with its pid is alive and **is the turn's own** (a pid
alone may have been given to another process since, and macOS has no process start time without starting `ps`), so its
process group may be signalled; the turn goes on live, its private folder adopted from the meta (`PrivateDirs.adopt`: the
files by name and hash, nothing rewritten and no crash clean-up while it runs, so a Codex login the process rewrites still
goes back as `authJson`), its question socket listening again in the same folder for the same token (`reopenAskBridge`,
checked against the token's SHA-256), and its outputs folder as noted (`ArtifactCollector.restore`). No keeper answers and
no `exit.json`: the keeper died without recording the end (killed while the runner was away), so the turn ends
`process_lost` (`stopped` if a stop had begun), with the parser's failing result; nothing is ever signalled then. A turn
whose harness this runner no longer has is left running, unwatched (its server fails it after the grace).

**Delivery** (`turn/events.ts`): a turn is attached while its link is up and, after a reconnect, once the server said where
to resume. Detached, its events wait in the log. The runner names every turn it holds in its hello (`runner.hello.turns`:
id, last event number, ended); the server answers `turn.resume {turns: [{turnId, lastSeq}]}`, the highest event number it
stored for each, and the runner resends what follows from the log (a question as `turn.question` again; one the agent was
told was not shown, because the link was found down as it asked, as an `info` notice in its place), then goes on live,
and for an ended turn sends its task step's files and `turn.end`. `lastSeq: null` means the server no longer has the turn
(it failed it after the grace, or never heard of it): the runner stops it by the ladder, sends nothing, and removes its
folder. A server older than this (no `server.hello.resume`) gets the same: it failed those turns already.

**The server** (`modules/machines/service/runner/hub/turns.ts` and `hub/turn-resume.ts`, `modules/chats/service/live.ts`, `service/adopt.ts`):

- When the link of a runner that keeps turns (`caps.reattach`) drops, its turns stay `running` and become **detached**
  (the stream sends the turn with `detached: true` and `detachedAt`, the chat's detail says both, the web's working pill
  reads "Reconnecting to Airia devbox… 2:14", the open chat's machine and how long it has been away, and a task's
  conversation reads "Reconnecting" while the task stays worked on) for the grace, `MWC_TURN_GRACE_SECONDS` (1800 s, 30
  minutes, by default since 2026-11-12, 180 s before; 1 to 86 400; one default for every machine: a runner that comes
  back without a turn ends it at once and Stop ends a detached turn at once, so a long wait costs nothing when the
  runner is gone for good). An older runner's dropped link fails them at once, since it ended their processes with the
  link.
- A hello naming a turn re-binds it to the new connection (its grace ends, the stream says `detached: false`) and the
  answer is the turn's highest stored event (`turnsRepo.lastEventSeq`, read on the turn's own write queue, after what came
  before is stored). Events are stored `ON CONFLICT DO NOTHING` on `(turn, seq)`, so a resend stores nothing twice.
- A detached turn of the machine that the hello does not name ends at once: the runner no longer has it. The grace
  running out ends it too, and the task hook blocks its task once. Since 2026-11-12 the error names the machine
  (`awayError`, the machine's name read by the hub): `machine_disconnected: Airia devbox was unreachable for 30 minutes:
  the turn stopped.`, `machine_disconnected: Airia devbox came back without this turn: it stopped there while the link
  was down.`, or for an older runner `machine_disconnected: Airia devbox disconnected, and its runner is too old to keep a
  turn across a dropped link: …`. The web and the blocked task show the words after the code (`disconnectedWords` of
  `@mwc/shared/chats`); a bare `machine_disconnected` from before reads "The agent's machine was unreachable for too
  long: the turn stopped."
- **A late re-attach** (2026-11-12, `chats/service/reclaim.ts`, the safety net under the grace): a hello that names a
  turn the server already failed because its runner was away (`machine_disconnected…` or `server_restarted`) takes it
  back when no later turn of its chat ever started (`startedAt`): its row is `running` again (no error, no end) and it
  goes on as any turn taken back (`turn.resume` with its last stored event, its end recorded normally). A task step's
  turn is taken back only when the task is still active at that step, blocked with that failure's words, and nothing
  but an edit happened to it since (its latest history row is that block); the tasks module's hook
  (`TaskTurnHook.reattached`) then sets it working again with a system `started` row ("The machine came back with the
  turn; it goes on"), waking nobody (a Lead's wake-up for the block, not told yet, is dropped as stale). Otherwise the
  turn stays failed (its row put back as it was) and the runner hears `lastSeq: null`, stops it and forgets it, as
  before.
- At the server's start (`reapTurns`, before it listens), only the waiting turns of chats where nothing runs fail
  (`server_restarted`); running turns stay. A hello naming one that no sink of this process holds is taken back
  (`turnAdopter`): the turn's row (running, of a chat on that runner's machine), the credential it runs on (whose, of which
  kind, for a Codex login to seal again), its task's step and round, and its stored events (the reply and usage so far)
  make its sink. Once the grace after the start is over (`failLeftTurns`), each running turn the stopped server left that
  no runner took back ends through such a sink with `server_restarted`: its task is blocked once and the chat's waiting
  messages start, as after any turn's end.
- **Stop while detached** is accepted (202) and, since 2026-11-12, ends the turn at once (`stopped`; until then it waited
  for the runner or the grace, which a 30-minute grace made too long); a runner that comes back with it hears `lastSeq:
  null` and stops it by the ladder.
- **One live turn per chat** holds while a turn is detached: it is still `running`, so a prompt is refused
  (`turn_running`) or queued, and the queue starts nothing until the turn ended.
- `turn.ack {turnId}` goes to a runner that keeps turns once the sink recorded the turn's end.

**Stop ladder**: SIGINT to the keeper's process group, SIGTERM 10 s later, SIGKILL 20 s after the SIGINT
(`TURN_STOP_TERM_MS`, `TURN_STOP_KILL_MS`), each only while the keeper is there (its child's exit, or its socket's close,
says it is gone). A turn taken back walks it through the pid its keeper's socket greeted with; a turn whose meta says a
stop had begun walks it again when it is taken back.

**The runner stopping on purpose** (a service stop, its self-update, `kill`) now **leaves its turns running**: it lets go
of each (its line to the keeper closed without `end`, its question socket closed but its folder kept) and the next runner
takes them back. Its terminals still end, as before (they are PTYs of the runner's own process). The self-update no
longer waits for chat turns (only runs, terminals and an install), and the server no longer refuses Update runner for
turns a runner keeps through its own restart (a self-update or an SSH reinstall; a container's rebuild still ends them,
so turns still count there). The systemd unit says `KillMode=process`, so a restart kills the runner alone; a unit from
before is brought up to date when the runner starts under systemd (`healUnit`: one `systemctl --user daemon-reload`, only
when it changed). launchd kills only the job's own process group, which the keepers are not in. A container's stop or
restart still ends its processes, since they live in the container.

**Tests** (no real CLI): the keeper in-process (its files, exit, socket greeting, commands, orphan close); the runner on
the fake keeper (`FakeSpawn` plays it) for the event log, detaching and resending, forgetting, taking back from the folder
with a private folder, outputs folder, question socket and messages, and the ladder walked again; and on real processes
(`test/turns/runs/survive.test.ts`: the real keeper, `node src/main.ts keep`, and the fake harness binary): a turn taken
back mid-turn with the events continuing once, the end while the runner was away with and without `exit.json`, the full
ladder on a taken-back turn, a live stranger holding the recorded pid never signalled, Claude Code's input mode across a
take-back, and the chaos test, a runner process killed with SIGKILL mid-turn (`test/fixtures/turn-host.ts`). The server's
side on PGlite with `FakeRunner` (`test/modules/chats/service/survive.test.ts`): detached and resumed with the events
after the stored ones, a hello leaving a turn out, an unknown held turn, Stop while detached (ended at once, the runner
told when back), the queue, a restarted server taking a turn back, the grace failing a task's turn once in words, and the
left-turn sweep; the late re-attach (`reclaim.test.ts`): a chat turn resumed after the grace, one refused after another
turn started, one that ended otherwise, a task step's turn carrying its task on, and one refused after the task moved;
the hub's words and the immediate stop (`hub/turns.test.ts`), and the rules (`carriedOn`, `awayError`).

## Standing instructions

Built 2026-11-11 (Ihor: "this instruction as NON modifiable 1 piece … but with an idea that user can see/read it"). Every
turn and terminal of an agent carries standing instructions in its spec (`instructions`): first the agent's **briefing**,
its place in the company generated from the live org chart, then its own instructions (the agent form's Instructions,
`## Your instructions`, left out when blank). Before 2026-11-11 a turn carried neither.

- **The briefing** is `agentBriefing` of `@mwc/shared/agent-briefing`, pure, so the server and the web write the same
  text from the same chart: the heading `## Your place in the company (generated by Most Wanted from the org chart; not
  editable)`, then one line each: who it is (`You are <name>, <role>, at <company>, an AI agent on its org chart.`; the
  role is the title on the chart, else the role title, left out when it repeats the name), its manager (`You report to
  <name> (<role>; a person|an agent).`), the chain up to the top when the manager has a manager, its teammates (the
  manager's other reports), and its reports (`Reporting to you: …` or `Nobody reports to you.`). Facts only, no rules.
  People show their display name (`Unnamed person` without one), never an email; no ids. Paused agents are listed
  `(…; an agent, paused)`; archived ones are off the chart, so left out, and an archived agent is told only that it is
  not on the chart. Whitespace in a name is folded to one space (a name never starts a line); a list names 25 and counts
  the rest; at most 20 000 characters. `version` is an 8-hex FNV-1a of the text. The server reads it per turn
  (`standingReader` of the org module, the chats module's `TargetDeps.standing`), so a move on the chart reaches the
  chat's next turn, resumed, without a new chat; a terminal gets it when it opens.
- **The API**: `GET /api/companies/{companyId}/agents/{agentId}/briefing` (viewer and above) answers `{ briefing,
  version }`, the text the next turn gets before the agent's own instructions. The agent page shows it read-only above
  the editable instructions ("From the company", "Generated · updates with the chart"), outside the 100 000-character
  limit and the instructions' revision; the Hire page previews it from the chart once a manager is chosen.
- **Claude Code** (verified against 2.1.322's `--help` and its bundled code): the text goes in a private file the
  runner writes 0600 beside the settings file and removes after the process (`instructions-<12 hex>.md`, its own per
  process), named by `--append-system-prompt-file` (hidden from `--help`, which names it under `--bare`; with
  `--append-system-prompt` too since 2.1.283, the file's text first), never on the command line (`ps`, the argument
  limit). With the runner's tools, the asking line goes at the end of the same file instead of `--append-system-prompt`.
  Claude Code records a conversation's system prompt on its first request and resends that record on every later
  request and resume, "even when a later launch passes different text, until the conversation is compacted"
  (`--system-prompt-snapshot`, on by default since 2.1.267); so a process with standing instructions gets
  `--system-prompt-snapshot off`, which renders the system prompt fresh on each request, as before 2.1.267. **Holds on
  resume.** Cost: with the snapshot off, the system prompt's per-machine parts (git status, date) are rendered again in
  each turn's process, and a change there misses the prompt cache for that turn, as before 2.1.267; not measured
  without a real turn.
- **Codex** (verified against the openai/codex source at 0.162.1, 0.163.0 and 0.167.0): the text is the Codex home's
  `AGENTS.override.md` (`CODEX_HOME` is the runner's private folder, or the placement's configuration folder), written
  0600 for the process's lifetime like the login. Codex reads `AGENTS.override.md` (else `AGENTS.md`) of its home before
  each request (`codex-home/src/instructions`) and keeps what the model last saw in the thread's world state (the
  `agents_md` section of `core/src/context/world_state`): a new text reaches a resumed thread at its next turn as "These
  AGENTS.md instructions replace all previously provided AGENTS.md instructions.", an unchanged one is not sent again,
  and the project's own `AGENTS.md` files still follow it. **Holds on resume.** `developer_instructions` would not: Codex
  sends it only with a thread's first context. Limits: a configuration folder that is a person's own Codex home has its
  `AGENTS.override.md` set aside while the process runs (their `AGENTS.md` is then not read, as Codex reads one); agents
  sharing one home folder share one Codex home (as they share its login file), so two of them running at once see the
  last writer's text.
- **Older runners**: the field is optional and protocol objects are loose, so a runner from before it passes the spec
  through and its driver ignores the field: no standing instructions until the machine's runner is updated (Update
  runner on its card). No server refusal.

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
  `--allowedTools mcp__mwc__ask_user_question` (a mode that asks refuses tools that need approval in print mode) and one
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
  composer stays open: a message instead answers in words. Since S6c the company's admins and owners get a notice when a
  question is stored (`agent_question`, docs/notifications.md), and the Inbox's card answers it in place with the same
  form (docs/processes.md "Inbox answers").

## Agents' tools

Built in S6a (2026-11-11; what they do for a task is docs/processes.md "Built in S6a"). The same bridge as the questions
gives a turn the agents' tools: a task step's (`task_read`, its kind's moves, `task_attach`, `task_blocked`) or a flow
Lead's in its own chats (`team_board`, `task_show`, `task_create`, `task_route`, `task_start`, `task_retry`,
`task_cancel`). The names, inputs and words are `@mwc/shared/flows`'s (`AgentTool`, `AGENT_TOOL_INPUTS`,
`AGENT_TOOL_INFO`), and the runner and the server check an input with the same `checkToolInput`; the token and socket
model is unchanged.

- **Which tools.** The server names them in the turn's spec (`TurnSpec.tools`, by name; at most 32, each once; a name a
  runner does not know is passed over) only when the runner says `caps.agentTools`. The runner keeps the names it knows
  (`knownTools`, `turns/ask/agent-tools.ts`) and hands them to the driver (`TurnTools.names`, `ask_user_question` first)
  and to its MCP server through `MWC_TOOLS` (comma-joined; left out when none). A turn whose socket cannot open runs
  with no tools, as before.
- **The MCP server** (`runner.mjs mcp`) lists `ask_user_question` and the turn's agent tools (`tools/list`, each
  `inputSchema` generated from its zod input by `z.toJSONSchema`, `$schema` left out; `readOnlyHint` for `task_read`,
  `team_board`, `task_show`). A call of an offered tool is checked against its input first (a bad one is a tool error
  "<tool> did nothing; fix its input and call it again:" with each issue), then relayed; a tool the turn does not offer
  is -32602 "Unknown tool".
- **The socket.** One more request line, `{token, tool, input}` (beside `{token, questions}`, which still works: an MCP
  server an older `runner.mjs` started may talk to a runner that took its turn back after a self-update), answered by
  the same `{ok, text}` or `{ok: false, error}`. Once the request line is in, the connection's idle limit
  (`ASK_CONNECTION_MS`) no longer applies; the MCP server waits up to 60 s for a tool (`TOOL_TIMEOUT_MS`), 10 s for a
  question.
- **The relay** (`turns/turn/tools.ts`, `TurnToolCalls`). The turn reads its output so far and sends its batched events
  first, then `turn.tool {turnId, callId, tool, input}` (`callId` a new UUID), and waits up to 55 s (`TOOL_REPLY_MS`)
  for `turn.tool.result {turnId, callId, ok, text}`, whose text the tool returns (`ok: false` as a tool error). Not
  numbered among the turn's events: the harness's own `tool` and `tool_result` events show the call in the thread. A
  turn ending or stopping answers "This turn is ending; the tool did nothing."; a link that is down answers that the
  runner lost its link (nothing queued); a call left waiting when the link drops or the runner lets go says it may or
  may not have taken effect; one past 55 s says the server did not answer in time.
- **`task_attach {path}`** is read on the runner, which alone sees the files: the path must be a plain path inside the
  turn's outputs folder (`isArtifactPath`), a regular file whose real path is that one (a link is refused), at most 2 MB,
  text or an image (`ArtifactCollector.attach`); each refusal is said in words ("not in your outputs folder", "no such
  file", "over the 2 MB", "neither text nor an image"; a turn without an outputs folder says it has none). The file goes
  first as `turn.artifact` parts carrying the call's id (index 0), then the call with `input.file {path, contentType,
  size, sha256}`; the server puts it together and checks it apart from the turn's collection, names it by its path, and
  the end-of-turn collection does not send it again unless it changes.
- **The server** (the machines module's hub, `hub/tools.ts`): a `turn.tool` goes to the turn's sink (the chats module,
  on the turn's write queue so a decision is written before the turn's end), which asks the tasks module's hook
  (`TaskTurnHook.tool`, with the turn, its chat, the chat's agent, who sent the prompt and, for a task's conversation,
  its step and round); its answer goes back as `turn.tool.result` on the connection that carries the turn then (cut to
  50 000 characters, never empty). A turn whose sink takes no calls answers that the server offers it no tools. The hook
  re-checks everything (docs/processes.md "Built in S6a"); the runner's checks are never trusted.
- **The harnesses.** Claude Code's `--allowedTools` is one comma-joined argument with every tool the server offers
  (`allowedTools`, `claude --help` 2.1.322: "Comma or space-separated list of tool names to allow"), so a mode that asks
  does not refuse them in print mode; a name that is not one plain lower-case word is passed over. Codex gets the same
  MCP server with `MWC_TOOLS` among its `env_vars` and the same approval mode (`approve`), so its tool names stay off its
  command line. The asking line in Claude Code's appended system prompt is unchanged; what the step's tools do is in
  the step's prompt, and a Lead's section in its chats' standing instructions. Whether a real turn calls them is not
  verified without one (no test runs a real CLI).

## Server tools

Built in S7.1c (2026-11-13; what they do is docs/subscriptions.md, "Atlassian tools", "GitHub tools" and "Slack"). The server's
own tools are defined and answered whole by the server, so the runner lists and relays them without knowing them: a new
server tool needs no new runner. The first are the Atlassian tools, which keep the names and inputs of Atlassian's remote
MCP (`searchJiraIssuesUsingJql`, `getJiraIssue`, …), so they may be camelCase; the GitHub tools (S7.1d) keep GitHub's MCP
server's (`search_pull_requests`, `pull_request_read`, …), the Slack tools (S7.1e) the Slack MCP servers'
(`slack_get_channel_history`, `slack_post_message`, …). The integrations module's one hook (`service/tools.ts`) asks
Atlassian's, GitHub's and Slack's in turn and merges their plans: tools one after the other, lines one under the other,
labels in one sentence ("Jira, Confluence, GitHub and Slack").

- **Which turns.** A message turn whose profile (the chat's own, else the agent's: the one the turn runs on) offers them,
  on a runner that says `caps.serverTools`: the chats module asks its `ServerToolsHook` (`chats/service/server-tools.ts`,
  implemented by the integrations module and passed by `app.ts`) and puts them in the spec whole
  (`TurnSpec.serverTools`: `{name, title, description, inputSchema, readOnly}`, at most 64 (S7.1e; 32 before), each name once and never the
  question tool's or an agents' tool's, `ServerToolDefs` of `@mwc/shared/harness`), with the hook's line after the
  standing instructions (left out when it would not fit). A Compact, a Clear or an older runner gets none; a message
  turn on an older runner gets instead one line saying its tools (the plan's `label`, "Jira and Confluence") are
  configured but this machine's runner is too old to provide them, and the chat's detail names them
  (`runnerUpdateFor`), which admins see as a line above the composer linking to the machine's card.
- **The runner** (`turns/ask/server-tools.ts`) writes them to the turn's private folder (`server-tools.json`, 0600, next
  to `ask.sock`) and names that file to its MCP server (`MWC_SERVER_TOOLS`, among the variables Claude Code's `mcp.json`
  and Codex's `env_vars` carry). The MCP server lists them after the agents' tools, as written (`readOnlyHint` from
  `readOnly`, `openWorldHint` true), and relays a call with its arguments as they are, once they are an object (anything
  else is a tool error); the socket's request line and `turn.tool` take the name (`ServerToolName`: a letter, then
  letters, digits and `_`, up to 64). The bridge relays any such name for the server to decide, so a turn taken back
  after a runner's restart keeps its server tools. Claude Code's `--allowedTools` names them too (`mcp__mwc__getJiraIssue`;
  one plain word of letters, digits and `_`).
- **The server.** A `turn.tool` of a server tool goes from the turn's sink to the hook (`owns`, then `tool` with the turn,
  its chat, the chat's agent, the turn's profile and who sent its prompt), off the turn's write queue: it waits on an
  outside system, which the turn's events must not. The hook checks everything again and answers in words; it never
  throws.
- **How many** (S7.1e, 2026-11-13). Atlassian's 15, GitHub's 14 and Slack's 9 together are 38, past the 32 a spec
  carried until then. A runner since S7.1e says `caps.serverToolsMax` 64 and parses 64 (`SERVER_TOOLS_MAX`); an older one
  says nothing and parses 32, so the server sends it at most 32 (`serverToolsLimit`). Past a runner's limit the merge
  leaves the least important out first, in a stated order (`DROP_FIRST` of `rules/plans.ts`: `request_copilot_review`,
  `slack_get_user_profile`, `search_repositories`, `list_branches`, `getPagesInConfluenceSpace`, `getConfluenceSpaces`,
  `getVisibleJiraProjects`, `lookupJiraAccountId`, `get_commit`, `list_commits`, `slack_get_users`, `slack_add_reaction`,
  `getTransitionsForJiraIssue`, `search_issues`; then the last ones), keeps every main read and every write, and adds a
  last line naming what it left out and that the runner's update brings it back; the chat's notice then says "all 38".
  So a profile with all three parts on an older runner loses `request_copilot_review`, `slack_get_user_profile`,
  `search_repositories`, `list_branches`, `getPagesInConfluenceSpace` and `getConfluenceSpaces` until the update.
- **Rebuilding the runner.** The runner's side (the file, `MWC_SERVER_TOOLS`, the listing and relay, `caps.serverTools`,
  the wider `--allowedTools`) is new in S7.1c: a machine's runner must be rebuilt and updated once (its card's Update,
  or `docker compose … up --build` for a container runner) before its turns get any server tool. After that, new server
  tools need no runner change. S7.1e changed it once more (`caps.serverToolsMax`), only so a turn may carry more than
  32: a runner not updated keeps working with 32.

## git in a turn

Built in S7.1d (2026-11-13; the GitHub tools on the server are docs/subscriptions.md "GitHub tools"). Ihor's Mac pushes
over SSH with its own key and has `gh` signed in through GitHub's device sign-in; an agent's machine has neither, so a
turn whose profile may push gets the profile's GitHub sign-in for that turn only.

- **When.** A message turn (a chat's or a task step's) whose profile's GitHub part has a sign-in, reaches a repository
  and has `push` on, on a runner that says `caps.github`: the integrations module opens the sign-in for `tool:git` (a
  `credential_uses` row) and the spec carries `TurnSpec.github {token, repos}` (the allowlist lower-case). With `push`
  off no token reaches the machine at all; an older runner never receives it (it has no `caps.github`) and the turn's
  line says the runner must be updated; a Compact or a Clear gets none; the chat terminal gets none.
- **The environment** (`apps/runner/src/turns/git/env.ts`), added to the turn's process environment after the
  driver's, never anywhere else:

  | Variable | Value |
  | --- | --- |
  | `GH_TOKEN` | the token: gh uses it for github.com |
  | `GH_PROMPT_DISABLED`, `GIT_TERMINAL_PROMPT` | `1`, `0`: neither ever waits for a prompt |
  | `MWC_GIT_REPOS` | `all`, or the allowlist comma-joined (`airiallc/*,abibas/sandbox`), for the hook |
  | `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>` | git's settings, numbered after any the machine's environment sets: `credential.https://github.com.helper` empty (the machine's own helpers, its keychain or `gh auth git-credential`, are passed over for github.com), then `!f() { test "$1" = get \|\| exit 0; echo username=x-access-token; echo "password=$GH_TOKEN"; }; f` (git runs it with `sh`; it answers `get` only, so git never stores the token); `url.https://github.com/.insteadOf` `git@github.com:` and again `ssh://git@github.com/` (an existing SSH remote pushes over https with the token); `core.hooksPath` the runner's hooks folder |

  The token is in no setting (the helper reads `$GH_TOKEN` when git asks), on no command line, in no file, in neither
  the run folder's meta nor the runner's log. Like Claude Code's own token, it is readable while the turn lives by the
  machine's root and by the same user (a process's environment); the runner's machine is the agent's.
- **The hooks** (`turns/git/hooks.ts`): one POSIX `sh` script (git and `awk` only) written as each client-side hook's
  name (`pre-commit`, `commit-msg`, `pre-push`, …, not `reference-transaction`) into `<runner state>/git-hooks/`, files
  and folder 0555, rewritten before a turn when the runner's version changed; when they cannot be written the turn runs
  without the sign-in (logged), so no push goes unguarded. `pre-push` reads the remote's name and address and each ref
  pushed, and refuses with a line on stderr ("Most Wanted: refused: …"):
  - a push to the remote's **default branch**: its `refs/remotes/<remote>/HEAD`, else what `git ls-remote --symref`
    says now, else `main` and `master`;
  - a **non-fast-forward** update (the remote's commit not an ancestor of the one pushed, or not here: "fetch and
    rebase or merge first; never force"), so `--force` fails too;
  - a **deletion** (`--delete`, `:branch`);
  - a **GitHub repository outside the allowlist**, read from the remote's address (`https://github.com/o/n`, with a user
    in it, `git@github.com:o/n`, `ssh://git@github.com/o/n`, `.git` or not, case ignored); another host is not checked
    (the sign-in is not sent there).

  Since `core.hooksPath` replaces the repository's own hooks, each hook then runs the repository's own of the same name:
  its own `core.hooksPath` from any scope but the turn's (Husky's `.husky`), else its git folder's `hooks/`; `pre-push`
  passes on what it read. **It prevents mistakes, not malice:** `git push --no-verify` skips it, and an agent can change
  its own environment. The hard guarantee is GitHub's: branch protection or a ruleset on each default branch (require a
  pull request, block force pushes and deletions), and a fine-grained token limited to the repositories that may be
  pushed to.
- **The machine's own sign-ins.** Without the turn's sign-in (push off, or no GitHub part) a turn's git and gh are the
  machine's as they are: a Local runner on Ihor's Mac still has his SSH key and his gh. A profile's rights govern what
  Most Wanted hands over, not what a machine already has.
- **Codex.** Claude Code's commands inherit its environment. Codex runs commands under its own shell environment policy,
  whose default drops variables whose names contain `KEY`, `SECRET` or `TOKEN`, and its Ask and Auto sandboxes keep the
  network off, so a Codex agent's push and gh are expected to work only in Full trust, and only if its policy keeps
  `GH_TOKEN`: not verified (no real Codex turn is run). The server tools work for both harnesses.
- **gh** is in the Docker runner's image (2.103.3, checksum-pinned as the sign-in image's, prompts and update notices
  off); elsewhere it is the machine's own (`caps.tools.gh` reports it). The briefing and the turn's line say the server
  tools are preferred for reading and pull requests.
- **How many** (S7.1e, 2026-11-13). Atlassian's 15, GitHub's 14 and Slack's 9 together are 38, past the 32 a spec
  carried until then. A runner since S7.1e says `caps.serverToolsMax` 64 and parses 64 (`SERVER_TOOLS_MAX`); an older one
  says nothing and parses 32, so the server sends it at most 32 (`serverToolsLimit`). Past a runner's limit the merge
  leaves the least important out first, in a stated order (`DROP_FIRST` of `rules/plans.ts`: `request_copilot_review`,
  `slack_get_user_profile`, `search_repositories`, `list_branches`, `getPagesInConfluenceSpace`, `getConfluenceSpaces`,
  `getVisibleJiraProjects`, `lookupJiraAccountId`, `get_commit`, `list_commits`, `slack_get_users`, `slack_add_reaction`,
  `getTransitionsForJiraIssue`, `search_issues`; then the last ones), keeps every main read and every write, and adds a
  last line naming what it left out and that the runner's update brings it back; the chat's notice then says "all 38".
  So a profile with all three parts on an older runner loses `request_copilot_review`, `slack_get_user_profile`,
  `search_repositories`, `list_branches`, `getPagesInConfluenceSpace` and `getConfluenceSpaces` until the update.
- **Rebuilding the runner.** The runner changed in S7.1d (`caps.github`, the environment, the hooks): each machine's
  runner must be rebuilt and updated once, and the Docker runner needs **Update container** for gh.

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
  refusal's words ("The agent's machine has no connected runner") and the next is tried, except while a turn of the
  chat waits for its stopped machine: the queue then waits for the machine's runner ("When the machine is stopped"); while
  every slot of the machine is taken, the next turn waits for a free slot ("Waiting for a free slot"). A turn that starts after a
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
- **Turns Most Wanted queues** (S6c, docs/processes.md "Built: the Lead wakes up"): a flow's Lead wake-up is a message
  turn sent with `after` by the system, not a person: `chat_turns.system` (migration `0025_lead_wakes`), its `created_by`
  the agent itself (the credential's use names it too), shown as Most Wanted's in the thread and the waiting list. It goes
  to the flow's **team chat** (`chats.flow_id`, one of the Lead's own chats); a wake-up still waiting there takes in the
  next one instead of queueing another. Since the team room (docs/processes.md "The team room"): a person's message in a
  flow's room queues such a turn in each agent's own chat of the flow (`TeamChats.say`), naming the message
  (`chat_turns.room_message_id`, migration `0031_team_room`), delivered `after`; a wake-up never joins a room turn, and a
  room turn joins only the agent's own room turn still waiting. A task step's own prompt is Most Wanted's too
  (`system`), its `created_by` the person whose move started it. Every such turn tells the tasks module's hook its end
  (`TaskTurnHook.systemEnded`), which posts a room conversation's reply in the room unless it is silent.
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

A Docker runner's `docker exec` gets the image's `CLAUDE_CONFIG_DIR`, the same store its turns use (docs/machines.md
"The Docker runner's volumes"). Paths are single-quoted (`'` as `'\''`) and a command that crosses a second shell is double-quoted once more (`\`, `"`,
`$` and backquotes escaped); a test reads them back through `/bin/sh`. The popover says it uses that machine's own
login, not the chat's access profile, and that typing there spends it; a Codex chat's thread lives in the runner's
own folder unless the agent has a config folder, which it says too.

## A lost conversation

Built 2026-11-13 (Ihor's Docker runner was updated with **Update container**; the rebuild kept `/work`, the state and
the CLIs' volumes but not Claude Code's own store, and his next message in an existing chat failed at once with "No
conversation found with session ID: bbd9c214-…"). A chat's conversation lives in the harness's store on its machine
(Claude Code: `$CLAUDE_CONFIG_DIR/projects/`, else `~/.claude/projects/`; Codex: its `CODEX_HOME`, the runner's private
folder). Where that store survives a rebuild is docs/machines.md "The Docker runner's volumes"; when it still loses a
conversation (a wiped home, another config folder, a rebuild before those volumes), the chat no longer fails for good:

- **The runner tells it apart** (`turns/turn/end.ts`, `missingSession`). Each driver knows its CLI's own words
  (`HarnessDriver.sessionMissing`): Claude Code 2.1.323 prints `No conversation found with session ID: <id>` and exits 1
  (read from its own code); Codex 0.167.0 prints `Error: thread/resume: thread/resume failed: no rollout found for
  thread id <id> (code -32600)` and exits 1 (seen by running `codex exec resume` on an unknown id with an empty home and
  no login: nothing reached a model). When a turn's process exits with a failure, gave no good result, and the driver
  finds its words in the end of stderr or in a failing result, the runner sends no failing result and ends the turn
  `session_missing: <that line>` (`TURN_ERRORS`). The detection is the runner's because only it sees the harness's
  stderr and holds the drivers; the server branches on the typed code, never on the harness's words. The stderr stays
  in the run folder until the end's ack, so a runner restarted meanwhile ends the turn the same way.
- **The server starts the same turn again, once** (`modules/chats/service/session-lost.ts`, called from the turn's end
  in `live-end.ts`), for a message turn whose chat still names a session and which nobody asked to stop: resolved as any
  turn is (the person who sent it, the chat's profile, the agent's machine, a task step's outputs folder and tools), but
  with no session and no branch's fork. Its prompt is a recap, then the person's message (`rules/recap.ts`): the chat's
  own finished message turns since its last Clear (a branch whose fork never ran: its parent's, up to the reply it
  branched from), the latest 20, each the prompt and the final reply only (no tool calls, no thinking), each part cut
  at 3 000 characters and the oldest dropped until they fit 16 000. The chat forgets the lost session (`session_id`
  null, `fork_pending` false), and the thread gets a quiet `notice` as the turn's next event: "The saved conversation on
  <machine> was gone, so this chat started a fresh one with a recap of the last messages." (without a recap: "…started
  a fresh one."). The new `turn.start` goes under the same turn id once the runner heard the end's `turn.ack` (the
  sink's end returns what runs after the ack, `hub/turns.ts`), with `afterSeq` = that notice's number, so the runner
  numbers its events after it (kept in the run folder's meta for a restart). The new `session` event saves the new
  session, and the turn ends as any turn does. A task step's conversation (Keep context too) goes the same way with its
  own turns, and the task hears one start and one end.
- **Once.** The fresh start resumes nothing, so it cannot say `session_missing`; if it does anyway, or anything refuses
  the fresh start (the agent moved, the profile went, the spec does not parse, a failure is logged), or a Compact said
  it, or a stop was asked, the turn fails as before with `session_missing: …`. A runner older than this sends no such
  code, so its turns fail as before too: the recovery needs the runner's update.
- **Not covered.** The chat terminal (a TUI resuming a lost session shows Claude Code's own error; a message turn first
  starts the chat afresh), and whatever only the lost conversation's tool calls said.

## When the machine is stopped

Built 2026-11-12 (Ihor: his messages to an agent on a stopped devbox were refused with "The agent's machine is offline:
start its runner, then try again"; a message should start the machine, show its progress in the chat, and be sent once
it is up). The chats module's side is `service/machine-wait.ts`, `rules/machine.ts` and the queue's
(`repo/queue.ts`); the machines module's wake (docs/machines.md, "Waking a machine for work") starts the machine.

- **When a turn's machine has no connected runner**, a prompt (`POST …/turns`), a task's step and a Lead's wake-up ask
  the wake instead of refusing at once: a message as the trigger `message` (the person and their role, and
  `startMachine: true` when they asked to start it, Start and send), a step and a wake-up as `work`. A Compact or an
  answer is refused as before (`machine_offline`).
- **Started, or under way**: the turn is recorded `queued`, delivered `after`, with `machine_wait_at` (migration
  `0026_chat_machine_waits`; `machineWaitAt` on the turn), and 202 answers it. When the machine's runner connects (the
  hub's connect listener), each chat on it with such a turn starts its next waiting turn, as any queued turn starts
  (`drain.ts`). While such a turn waits, the queue does not fail the chat's other waiting messages for the missing
  runner; they start after it. A message sent meanwhile queues behind it; a Lead's wake-up joins a wake-up that waits.
- **It fails** with the wake's words when the start fails ("Airia devbox did not start: <why>"), and 10 minutes after it
  began waiting when the runner did not come (`MACHINE_WAIT_MS`: "Airia devbox did not connect within 10 minutes"; the
  timers are the app's, `machineWaitTimers` in tests). **Stop** (`POST …/turns/{turnId}/stop`) ends it `stopped`. A task's
  turn that ends so is told to the tasks module's hook (a failure blocks the task with those words), and a waiting turn
  of a step counts as its running turn (a move needs `force`, which stops it). At the server's start such turns fail
  with the other waiting ones (`server_restarted`).
- **Refused**: the switch for the trigger off and nobody asked: 409 `machine_stopped` with `error.machine {id, name,
  hourlyCost, canStart}` ("Airia devbox is stopped"; for work "…: start it on the Machines page, then retry", which
  blocks the step); nothing here can start the machine: 409 `machine_offline` in the wake's words ("This Mac is asleep:
  wake it, and its runner reconnects on its own").
- **The web** (`features/chats/`, the rail's docked chat too): a waiting turn shows in the thread as the person's message
  and one line that follows the machine, "Starting Airia devbox… 0:42", "Airia devbox is up · runner connecting…",
  "Sending…", with Cancel (`thread/status/MachineWait.tsx`, reading the machines and the machine's power every 5 s), and
  becomes the running turn when it starts. `machine_stopped` shows "Airia devbox is stopped." and **Start Airia devbox ·
  $0.54/h and send** above the box for those who may start it (`delivery/StartAndSend.tsx`), which sends the kept text
  again with `startMachine`. A task's conversation waiting for its machine says "Starting machine" on the task page.

## Waiting for a free slot

Built 2026-11-12 (on T-2 the DEVBOX Lead's two turns filled Airia devbox's 2 slots; the Developer's turn was refused
`busy` and its task blocked with the reason "busy"). The chats module's side is `service/slot-wait.ts`, `repo/slots.ts`,
`service/live-slot.ts` and `rules/machine.ts`; the waits' timers are the machine waits' (`machine-wait.ts`).

- **When every slot of a turn's machine is taken** (the turns running on it, in any chat, against the slots its runner's
  hello says, else its row's), a prompt (`POST …/turns`), a task's step, a Lead's wake-up or check-in, and a waiting
  message the queue would start all wait instead of going to the runner: the turn is `queued`, delivered `after`, with
  `machine_wait = 'slots'` and `machine_wait_at` (migration `0028_chat_slot_waits`; `machineWait` on the turn,
  `stopped` for a machine that starts, "When the machine is stopped"). Every other check holds first (refusals in words).
  A Compact or an answer does not wait: 409 `machine_busy` ("Airia devbox has no free slot (2 of 2 in use): try again
  when a turn there ends").
- **Who goes first.** A turn may take a slot when the live turns and the chats waiting longer than its own leave one
  (`slotFree`): the chat waiting longest first, a new message of a free chat behind every chat that waits. When any
  turn on the machine ends, after its own chat's queue, the chats waiting there start in that order while slots are free
  (`slotWaits.freed`).
- **The runner still says `busy`** (the server counted fewer turns than it runs): the turn goes back to waiting the same
  way, since when it first waited for a slot, and starts when a turn there ends; no end is told to a task or the queue.
- **A turn taken back late** ("Surviving restarts": its runner came back with a turn the server had failed) runs again,
  so it counts as running for the slots from then on; a waiting turn its failure let start meanwhile is refused `busy`
  by the runner if the machine is full, and waits again.
- **It fails** 30 minutes after it began waiting (`SLOT_WAIT_MS`: "Airia devbox had no free slot for 30 minutes (2 of 2
  in use)"); **Stop** ends it `stopped`; at the server's start it fails with the other waiting turns.
- **A task's step** stays `working` while its turn waits (the turn counts as the step's running turn: a move needs
  `force`); the task page's conversation says "Waiting for a free slot on Airia devbox" (`lastTurn.machineWait`, the
  conversation's `machine`). A step's failure is kept in words naming the machine ("The harness did not start on Airia
  devbox (ENOENT)"; a disconnection keeps its own words, "Airia devbox was unreachable for 30 minutes: the turn
  stopped."; `rules/failure.ts` of the tasks module, also when a turn taken back late undoes the block), and a bare code
  stored before is read back in words on the task page, the board, the Inbox and in a Lead's check-in.
- **The web**: the chat's waiting line says "Waiting for a free slot on Airia devbox 1:10" with Cancel
  (`thread/status/MachineWait.tsx`).

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
  (`{usedTokens, window, model, at, estimate?, baselineTokens?}`: the last `context` event's `usedTokens`, else its
  input + cache reads + cache writes, its `model` else `init`'s, or a later
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

## Branching

Built 2026-11-10 (Ihor: "I would love to have a BRANCH conversation button"). From a reply in a chat, a new chat with the
same agent continues the conversation from that point; the original is never changed.

**What each CLI supports** (checked without running a turn):

| CLI | Fork | From an earlier reply |
| --- | ---- | --------------------- |
| Claude Code 2.1.322 | `--fork-session` with `--resume <id>` ("When resuming, create a new session ID instead of reusing the original", `claude --help`): a new session from a copy, the original untouched | yes: `--resume-session-at <message id>`, a print-mode option `claude --help` does not list. Its own text (in the binary): "When resuming, only messages up to and including the chain entry with <message.id> (any chain-entry UUID, typically the kept turn's last entry)"; it requires `--resume`, and with `--fork-session` the cut copy becomes the new session. Without a fork it would cut the original, so the drivers refuse `resumeAt` without `forkSession` |
| Codex 0.167.0 | `codex exec fork [options] <SESSION_ID> [PROMPT]` ("Fork a previous session by id into a new session"; `-` reads the prompt from stdin; the same `-c`, `--json`, `--skip-git-repo-check` and permission flags as `exec resume`) | no: the CLI forks a whole thread. Its app server's `thread/fork` has turn boundaries (`beforeTurnId`, `lastTurnId`), but `codex exec fork` exposes none, and `exec --json` names no turn ids. So a Codex chat branches from the latest reply of a conversation only |

That `codex exec fork --json` starts with `thread.started` naming the new thread, and that Claude Code's `system/init`
after `--fork-session` names the new session, are read from the CLIs' own code and help, not from a real turn.

- **The route**: `POST /api/companies/{companyId}/chats/{chatId}/branch {turnId}` (admins and owners) → 201 the new chat,
  titled "<parent title> (branch)" (cut to 80). The reply must be a finished message turn of that chat (done, failed or
  stopped) with a `session` event (else 409 `turn_not_branchable`); 404 `chat_not_found`, `turn_not_found`; 409
  `turn_running` while a turn of the chat runs or waits, `agent_archived`, `branch_unsupported` (with the reason, for a
  harness that cannot fork: none today, `BRANCH_SUPPORT` of `@mwc/shared/chats`) and `branch_latest_only` when only the
  latest reply of its conversation can branch: always for Codex, and for Claude Code a reply recorded before message ids
  (no `messageId` on its result) or one followed by a compaction on its session (a Compact turn, or Claude Code's own
  compaction mid-turn: resuming loads the conversation from the last compaction, so the reply's message is gone).
  "Latest" means no later turn of the chat ran on the reply's session (a reply before a Clear is the latest of its own
  conversation). Audited as `branch`.
- **The branch** copies the parent's harness, machine, access profile choice (and who made it) and the reply's own
  session (its `session` event's), names the parent and the reply (`chats.branched_from_chat_id`,
  `branched_from_turn_id`, composite keys to the same company that set only their own column to null when the parent
  goes) and is `fork_pending` (migration `0018_chat_branch`; a CHECK holds `fork_pending` to a session).
- **Its first turn** (a prompt, a queued message or a Compact) resumes that session with `forkSession: true`, and with
  `resumeAt` = the reply's `messageId` when later turns of the parent ran on its session, read again at each try, so a
  parent that went on after the branch was made is still cut at the reply; one that can no longer be (Codex, a
  compaction since) refuses the turn with 409 `branch_latest_only`. A parent or reply gone forks the whole session. A
  runner older than branching (`caps.forks` false) refuses it with `runner_outdated`, since it would resume the
  parent's conversation in place. The turn's `session` event saves the new session and clears `fork_pending`; one that
  names the parent's own session leaves it pending, so the next turn forks again rather than continue the parent.
- **Before that turn** the branch opens no terminal (409 `branch_pending`), and a Clear clears `fork_pending` with the
  session (its next turn starts anew).
- **The page**: Branch (a branch icon) under each agent reply beside Copy, for admins and owners: enabled on the latest
  reply and, for Claude Code, on earlier ones that kept their message id with no compaction after; disabled with the
  reason as its tooltip otherwise (Codex: "Codex branches from the latest reply only") and while a turn runs; hidden on
  a reply without a conversation. It creates the branch and opens it; the branch shows "Branched from <parent title> ·
  <time>" at its top, linking back, and the chat list marks branches with a small branch icon. The branch's thread
  starts empty: the parent's earlier messages stay in the parent.

## Task turns

Built in S5.3b (2026-11-11; docs/processes.md "Built in S5.3b"). A task's step whose assignee is an agent runs as a chat
of that agent: a **task conversation**, a chat whose row names the task, the step and the round it began in
(`chats.task_id`, `task_step_id`, `task_round`, migration `0023_task_runs`). It is every bit a chat (the turn, its
checks and refusals, the credential's use, the standing instructions, the stream, Stop, the queue, the terminal,
"Open in Claude Code"); it only stays out of the agent's own chat list and is opened from the task.

- **Who starts it.** The tasks module, once a move started the task at an agent's step (an entry into a step that starts
  by itself, or Start), calls the chats module's `taskTurns.start` (`modules/chats/service/tasks.ts`) as the person who
  made the move (the turn is Most Wanted's, `system`, since the team room: the app writes the prompt): it finds the step's
  latest conversation of that agent and goes on in it when it can (not archived, the
  same harness and machine, and Keep or the same round), else begins one; the prompt is the full one for a new
  conversation and the delta for one that has a session (`stepPrompt` of `@mwc/shared/flows`). A refusal comes back to
  the tasks module as a `Refusal`, which blocks the task with its words. The two modules never import each other's code:
  the chats module defines the port `TaskTurnHook` (`service/task-hook.ts`) and the tasks module implements it
  (`taskTurnHook`); `app.ts` makes one chats runtime (`chatsRuntime`) and hands `taskTurns` to the tasks routes and the
  hook to the chats.
- **Every message turn of a task conversation** (the step's own, a person's reply in it, a queued message) asks the hook
  before it starts for its round and outputs folder (`prepare`: the step's current entries, `tasks/T-12/artifacts/<n>-<step>/round-<n>`),
  which go in the spec as `artifacts: {dir}` (`TurnSpec.artifacts`, optional: a runner older than it passes it through and
  collects nothing); tells it when it starts (`started`: a task waiting, ended or blocked at the step is worked on again,
  by the replier); hands it each file the runner collected and what it left out (`collected`, `skipped`, on the turn's
  write queue); and, once its row is closed, its end (`ended`: the reply as the round's hand-off note, then
  `ended_without_handoff` or, for a failed turn, `blocked`). A Compact or a Clear in a task conversation is not reported.
  The hook logs its own failures and never throws into a turn's queue.
- **The runner's side** (`apps/runner/src/turns/artifacts/`): before the process, `ArtifactCollector.open` makes the
  folder under the agent's home (it must stay inside the home once links are followed) and notes what is there; after
  the process ends, after its last events and before `turn.end`, the files new or changed (size or time) go out as
  `turn.artifact` parts and one `turn.artifacts` (docs/runner-protocol.md "Artifacts"). A collection that fails is logged
  and the turn still ends.
- **The server's side** (the machines module's hub, `hub/artifacts.ts`): each file's parts are put together in memory
  (at most the turn's 10 MB), checked against the size and SHA-256 every part names, typed again from the bytes
  (`artifactContentType`), and handed to the turn's sink whole; a file that disagrees is dropped with a log line.
- **Moving a task while its turn runs** (`POST …/tasks/{taskId}/actions`) is refused with 409 `step_running` unless
  `force`, which stops the turn after the move.
- **Its tools** (S6a, "Agents' tools"): a message turn of a task's conversation gets its step's tools when its runner
  offers them (`TaskTurnHook.toolsFor`) and its calls go to the hook (`TaskTurnHook.tool`); a move it records is applied
  when the turn ends (`ended`), in place of `ended_without_handoff`. The step's prompt is written for the tools then
  (`TaskTurnRequest.prompt.tools`; `.plain` for an older runner).
- **A stopped machine** ("When the machine is stopped"): a step's turn starts the agent's machine when its policy starts
  it for work, and waits for it with the task `working`; otherwise the task is blocked in words ("Airia devbox is
  stopped: start it on the Machines page, then retry").
- **A full machine** ("Waiting for a free slot"): a step's turn waits for a free slot with the task `working`, never
  blocked "busy"; after 30 minutes the task is blocked in words.
- **A dropped link or a restart** (S5.4, "Surviving restarts"). A task's turn is a chat turn: it waits the grace for
  its runner and goes on when the runner comes back, so its task stays `working` (no false `blocked`). Only a turn that
  finally fails ends through its sink (`machine_disconnected` when the grace after a dropped link runs out,
  `server_restarted` for a turn a stopped server left that no runner took back), and the hook blocks its task once. At a
  server's start, a waiting message of a task's conversation where nothing runs fails (`app.ts`'s `reapTurns`) and is
  reported to the hook the same way.

## Your direct reports in the rail

Built 2026-11-12 (Ihor's ask: "a chat to PM … in shortcuts for me … chats with my direct reports"). The chats he has all
the time sit in the right rail of every company page, beside the Inbox (docs/processes.md "Built in S6b").

- **Who shows.** The viewer's direct reports who are agents: the principals whose place on the chart reports to the
  viewer, not archived (paused ones stay, muted), the Leads (an agent that leads a flow) first, then by name. People who
  report to the viewer are left out: there are no chats with people. Viewers (the role) read no chats, so they see none;
  nobody with no direct reports who are agents sees the strip's group or the Chats tab.
- **The main chat.** An agent's main chat with the viewer is the latest chat the viewer began with it (by `updated_at`,
  which each sent message moves, as the agent's chat list orders them), not archived, neither a task's conversation
  (`task_id`) nor a flow's team chat (`flow_id`). Another person's chat with the same agent is theirs. None: the first
  message from the rail begins one (`POST …/agents/{agentId}/chats`, then the message), as New chat does.
- **The read.** `GET /api/companies/{companyId}/me/report-chats` (member and above; the chats module,
  `routes/reports.ts`, `service/reports.ts`, its reads in `repo/reports.ts` and the pure parts in `rules/reports.ts`):
  per agent its `agent` (id, principal, name, slug, role, status), `team` (the flow it leads with its latest team chat,
  or null), `chat` (the main chat's id, title, `updatedAt`, or null), `lastTurn` (status and when it last changed),
  `working` (a turn runs), `question` (the last turn's question is open: the chats' own `openQuestion`), `replyAt` (the end
  of its latest message turn that is done) and `messageAt` (the viewer's latest message in it, not one Most Wanted
  queued). Six reads whatever the number of reports; nothing is written, and everything else goes through the chats' own
  routes. Another company's id is the same 404 as none.
- **Seen.** A reply is unseen while it ended after both the viewer's last message in the chat and what this browser has
  seen of that chat: the end of the latest reply shown in the rail or on the chat page, kept per chat in this browser
  (`mwc.railChats.seen`, shared between its tabs; `features/report-chats/seen.ts`). This browser's first look
  (`mwc.railChats.since`) counts as seen, so old replies do not light up; there is no table.
- **The strip** (the rail collapsed): under the inbox and the bell, the reports' icons, at most six (five and "+N", which
  opens the Chats view), each with a small dot: amber for a question waiting, green pulsing while a turn runs, blue for a
  reply not seen, none otherwise; the tooltip is the name and role (and the dot's words). A click opens the rail on Chats
  with that agent.
- **The Chats view**, a third tab beside Attention and Notifications (with three tabs the others show their icon and count
  only; its count, blue, is the chats with a question or an unseen reply): a header with the open agent's face, name and
  role, New chat (admins and owners) and Open full chat (the chat page with this chat), the switcher (every report's
  icon with its dot) and, for a Lead, With you / Team chat (its flow's team chat, where Most Wanted wakes it; "No team chat
  yet" before the first wake-up). Under it the chat page's thread and composer, narrow (`dense`): the stream, tool
  calls, subagents, questions and their answers, copy, delivery while the agent works, Stop and the waiting messages,
  without the context meter. The agent open last is remembered per company in this browser
  (`mwc.railChats.agent.<companyId>`). The list is read every 15 seconds while the page is visible, when the tab comes
  back, after a message and when the open chat's turn starts or ends.
- **Narrow screens.** Under 80rem the rail is the top bar's drawer; the same Chats tab works there (no strip).

The parts: `apps/web/src/api/report-chats.ts` (`useReportChats`), `features/report-chats/` (`use-report-rail.tsx`, the
rail's props, called by the inbox's `useCompanyRail`; `ReportStrip`, `ReportFace`, `DockedChats`, `LiveDockedChats`,
`DockedThread`, `DraftChat`, `standing.ts`, `seen.ts`), the layout's `chats`, `chatsCount` and `strip` props
(`RightRail`, `RailViews`, `RailStrip`), and `dense` on `ChatThread` and `Composer`. The gallery draws it on samples
(`pages/design/sample-rail-chats.tsx`; `?inbox=empty` without reports). Tests:
`apps/server/test/modules/chats/routes/reports.test.ts` (who shows and in which order, never people, paused and archived
agents; the main chat against an older one, an archived one, another person's, a task's conversation and a team chat;
the standing turns, a running one and a queued one, a compact, a failed turn, another person's and a system message; an
open and an answered question; a Lead's team chat, an archived one and another agent's; viewers refused, another
company's 404, an empty list) and `rules/reports.test.ts`.

## Tests

- Each connector's tests run every argument and environment combination and parse its fixtures, written from the
  documented formats, never recorded from a real turn (that would spend a subscription): Claude Code's `answer`, `tool`,
  `denied`, `error`, `resume`, `subagent` (a plan with `TodoWrite`, an Explore subagent with its own steps and `task_*`
  messages, one in the background ended by `task_notification`) and `compact`; Codex's `answer`, `tool`, `denied`,
  `error`, `resume` and `plan` (its to-do list started, updated and completed, reasoning). The runner's tests reuse them
  from `@mwc/harness-claude-code/fixtures` and `@mwc/harness-codex/fixtures`. Codex's session-file lines
  (`test/fixtures/follow.ts`) are built to its serializers: v2 activities in both persisted forms, spawn calls with
  their JSON arguments, a subagent's file forked with the parent's history, partial lines across polls; the runner
  follows them in a temporary `CODEX_HOME` on fake time.
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
- Task turns (S5.3b) are tested on PGlite with `FakeRunner`: auto and manual entry, Keep resuming the same session with
  the delta prompt, Fresh opening a chat per round, a block's words, the turn's end and failure, a person's reply, a move
  while running (refused, forced), the collected files (types, parts, limits, a bad hash, a binary file, a file collected
  again, an old runner without the frames), the artifacts API and the board's counts; the runner's collection on a
  temporary folder and on a sized fake file system (the limits, hidden names, links, a folder outside the home), and the
  frames before `turn.end`.
- The agents' tools (S6a) are tested the same way: the MCP server's `tools/list` per turn kind (questions only, a Work
  step's, a Check step's, the Lead's), each tool's input checked, a tool not offered refused; the socket's tool line
  (an asynchronous answer, the idle limit cleared, the old question line, a wrong token); a turn's relay on fake sends
  (the answer by its call id, the timeout, ending, offline, a call left waiting); `task_attach {path}` on a temporary
  folder (its parts before the call, a path outside the folder, `..`, a link, a missing file, over 2 MB, binary, no
  outputs folder, not collected again); both drivers' arguments; and the server on PGlite with `FakeRunner`: the tools
  and prompt each turn gets with and without `caps.agentTools`, each tool's validation, a wrong kind, a moved task, a
  decision applied at the turn's end, a second one replacing the first, a send-back past the limit escalating, a block,
  a failed and a stopped turn dropping it, attachments (a note, a link, a file, refusals), and the Lead's tools in its
  own flow and refused in another.
- The fake binary, `node FAKE_HARNESS_BIN`, plays a `FakeScenario` JSON file named by `FAKE_HARNESS_SCENARIO`: it reads
  stdin, writes what it got (argv, cwd, stdin, only the variables `recordEnv` names) to `record`, prints `lines` (after
  `delayMs` each), then `stderr`, waits `holdMs` and exits with `exitCode`. A runner test points `FakeHarnessDriver` at it
  (`command: process.execPath, args: [FAKE_HARNESS_BIN], env: { FAKE_HARNESS_SCENARIO }`) with `fakeLines(events)`, or
  replaces a real driver's command with it to play a CLI fixture through the real parser.

## Not supported yet

- Surviving restarts (S5.4) has its limits: a turn in a Docker container dies with its container (a container's runner
  restart is the container's); a runner that comes back after the grace finds its turn failed and stops it; Codex
  subagent steps written while no runner read the session files are not shown (the follower goes on from the files' end);
  a Codex login rewritten after the end was sent once but before it was acknowledged is lost if the runner restarts in
  between; terminals end with the runner as before.
- A Claude login's access token that expires during a turn longer than its remaining hour: the server refreshes it only
  before the turn. Two Codex processes on one private folder at once (a turn and a terminal) share one `auth.json`: the
  later one writes its login over a token the first may have just refreshed (the server seals again what comes back).
- A Codex chat's Terminal tab adds newer readings to the session file, but the meter updates only with the chat's next
  turn: nothing reads the file when that terminal closes (it would need a reading on `terminal.exit` and the server
  adding an event to an ended turn). Before a chat's first turn the window is the static table's, not the machine's
  `models_cache.json`.
- Codex takes no message mid-turn (`codex exec` reads its prompt once): Now is hidden for it. A Claude Code turn that
  takes a message after its result reports that result's usage as Claude Code counts it, and the parser's first-result
  bookkeeping (a background subagent still running becomes `interrupted`) is not redone for the extra turn.
- Approving a tool mid-turn (the permission tool): S6, over the same bridge. Until then a mode that would ask refuses in
  chat (a notice says what) and asks only in the terminal. Selections are built ("Asking the person"); the agent ends its turn after asking, and the answer
  is the next turn rather than a live reply.
- Branching: merging a branch back, branching from the person's message (to edit it), a Codex branch from an earlier
  reply (its CLI forks a whole thread), and showing the parent's messages inside the branch.
- Running as root: Claude Code refuses `--dangerously-skip-permissions` as root, which matters for container runs.

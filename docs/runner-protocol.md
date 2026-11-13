# Runner protocol v1

The contract between the server and the runner on every machine (S4.1, 2026-11-06; design in `docs/machines.md` and
`docs/architecture.md` sections 8 and 9). The code is `@mwc/shared/runner-protocol` (`packages/shared/src/runner-protocol.ts`
and its parts in `runner-protocol/`); the machine enums, the sample and the power policy are `@mwc/shared/machines`.
The server's hub and the runner both import these modules, so their TypeScript types are the contract; this page
explains them.

**Naming.** Frame types are dotted lower case (`runner.hello`). Fields are **camelCase**, as in every `@mwc/shared`
contract: architecture §8's snake_case names map one to one (`awake_ms` → `awakeMs`, `cmd_id` → `cmdId`,
`min_runner_version` → `minRunnerVersion`). Enum values are snake_case (`devbox_keepalive`, `set_timezone`). Times are
integer milliseconds since the epoch; ids are UUIDs; sizes are bytes of a frame's UTF-8 JSON text.

## Transport

One outbound WebSocket per runner: `GET /api/runner/ws` (`RUNNER_WS_PATH`) with `Sec-WebSocket-Protocol:
mwc-runner.v1` and `Authorization: Bearer <runner key>`. Every message is one JSON text frame of at most 256 KB
(`ws` `maxPayload`; larger closes with 1009). The server sends a WebSocket ping every 20 s and terminates a socket that
has not answered by the next one; the runner treats 40 s without any frame or ping as a dead socket. The runner
reconnects after every close with a backoff from 1 s to 60 s plus up to 20 % jitter, and never gives up, with three
exceptions (S4.3): a refused key (HTTP 401 at the upgrade, or 4001) and a runner too old (4003) stop the runner with a
log line and exit codes 77 and 76, so the service manager shows why; 4004 (replaced) ends the link without reconnecting
while the process stays up, so two copies of one machine never take turns. The Airia devbox has no public address: its
runner dials `ws://127.0.0.1:<port>/api/runner/ws` on the box, which its controller's reverse SSH tunnel makes the
server's own port ("Hold and power", `tunnel.set`).

**Auth tiers** (Buildkite style). An admin makes a one-time **enrollment token** (`mwc_et_…`, expires); the runner's
`install --token` (S4.5, through `install.sh`) trades it at `POST /api/runner/enroll` for the machine's id and its **runner key** (`mwc_rk_` + 32
base62, file mode 0600 on the machine, only its SHA-256 in `api_keys` with `kind=runner` and the machine). The runner
key opens this socket and nothing else; a wrong, revoked or unknown key is refused at the upgrade with HTTP 401 (no
socket). `key.rotate` replaces it; the old key keeps working 10 minutes. Each run gets its own **run token** in
`run.start` for its MCP and API calls back to the server.

## Enrollment

Added in S4.2 (`runner-protocol/enroll.ts`). An admin or owner makes a token with
`POST /api/companies/{companyId}/machines/enrollment-tokens` (no body; 201 `{id, token, expiresAt}`, the token
`mwc_et_` + 32 base62 (`ENROLLMENT_TOKEN_PATTERN`), shown once, its SHA-256 stored, good for one enrollment within
`ENROLLMENT_TOKEN_TTL_MS`, an hour). The installer trades it at `POST /api/runner/enroll` (`RUNNER_ENROLL_PATH`, no
session) with a `RunnerEnrollRequest`: `token`, `name` (1–80, trimmed), `kind`, `os`, `arch`, `hostname`, `unixUser`,
`runnerVersion`, `claudeVersion` (string or null), `provider`, `providerRef` (an `AiriaDevboxRef` for `airia_devbox`,
null for `none`). The answer is 201 `RunnerEnrollResponse{machineId, companyId, runnerKey}`, the key shown once and
owned by whoever made the token. An unknown, used or expired token, or one of a deleted company, is a 401 in the common
error shape; a body that does not match is a 400.

The installer and the runner it installs are served too (S4.5, `docs/machines.md` "Installing a runner"), both public:
`GET /api/runner/install.sh` (`RUNNER_INSTALL_SCRIPT_PATH`, a POSIX script piped into `sh -s -- --server … --token …`)
and `GET /api/runner/runner.mjs` (`RUNNER_BUNDLE_PATH`, the bundle, with its SHA-256 in `x-mwc-runner-sha256`,
`RUNNER_SHA256_HEADER`, which the script checks; 404 `runner_bundle_missing` until it is built), and the terminal's PTY
for each system, `GET /api/runner/pty/<target>.tgz` (`RUNNER_PTY_PATH`, a target of `RUNNER_PTY_TARGETS`: darwin-arm64,
darwin-x64, linux-x64, linux-arm64; with its SHA-256 in the same header; 404 `runner_pty_missing`), which the script
checks and unpacks beside the bundle (docs/machines.md, "Terminal").

## Connection

1. Runner → `runner.hello`. No hello within 10 s: close 4008.
2. The server checks `protocol` (unsupported: close 4002), marks the machine online, starts a `runner_sessions` row,
   and answers `server.hello`. A newer socket of the same machine closes the older one with 4004.
3. If the runner's `version` is below `minRunnerVersion` (`compareRunnerVersions`), the server closes with 4003 right
   after its hello; the runner logs that it needs an update and exits (76).
4. Runner → `runner.resync`, then `hold.state`; then a `runner.heartbeat` every 20 s.

Nothing lives only in memory on the server: after its restart every runner reconnects and repeats steps 1 to 4.

## Runner → server

| Type | Fields | When, and the answer |
|---|---|---|
| `runner.hello` | `protocol` (int ≥ 1), `version` (semver), `caps{harnesses{claude_code, codex} (each CLI's version, 1–100 characters, or null when it is missing; a runner older than chats sent the names alone, `["claude_code"]`, which still parses and means no turns: `harnessVersionOf` reads it as undefined), slots 0–64, hold devbox_keepalive\|caffeinate\|none, power[] of airia_devbox, terminal (boolean; false when left out, as by a runner older than the terminal), selfUpdate (boolean; false when left out, as by a runner older than it), folders (boolean: it answers `fs.list` and `fs.mkdir`, S5.1d; false when left out), mkdirp (boolean: it answers `fs.mkdirp`, 2026-11-13; false when left out, and the server then refuses it as `runner_outdated`), forks (boolean: its drivers fork a conversation for a branch's first turn, `TurnSpec.forkSession`; false when left out, and the server then refuses that turn), reattach (boolean: its turns outlive a dropped link and its own restart, S5.4, "Chat turns"; false when left out, and the server then fails its turns when the link drops), agentTools (boolean: its turns offer the agents' tools, S6a, `TurnSpec.tools` and `turn.tool`; false when left out, and the server then names none and writes the step's prompt for a person to move the task), serverTools (boolean: its turns list and relay the server's own tools, S7.1c, `TurnSpec.serverTools`; false when left out, and the server then sends none), tools? (`{claude, codex, git, gh, docker}`, each CLI's `--version` first line, 1–100 characters, or null; left out by a runner older than the tools, which knows no `tools.*` frame; "Tools" below), containerId? (in a Docker container, its id as the container's hostname says it, 12–64 lower-case hex digits; left out elsewhere, for a hostname set by hand, and by a runner older than it: the server rebuilds that container to update its runner, docs/machines.md "Updating a runner")}`, `claudeVersion?` (`claude --version`, 1–100 characters, or null; S4.2; the runner asks it once at start, S4.5), `build?` (the SHA-256 of the `runner.mjs` it was started from, 64 lower-case hex digits, or null from its sources; left out by a runner older than it), `builtAt` (when its bundle was built, UTC ISO 8601, or null from its sources; left out by a runner older than versioned runners, which parses as null; docs/machines.md, "Runner versions"), `turns?` (S5.4: the turns it holds, at most 256 `{turnId, lastSeq (the highest event number it gave the turn, 0 before its first), ended (its process ended; its last events, files and end are still to deliver)}`; left out when it holds none, and by older runners) | first frame; `power` lists the providers it can drive (`airia` and `gcloud` present and signed in); a hello without `claudeVersion` keeps the version on record; `build` against the bundle the server hands out is the machine's `runner.current` → `server.hello` |
| `runner.caps` | `caps` (the whole `RunnerCaps` again) | what it can do changed on the live link (its tools after `tools.check` or `tools.install`, sent before their `tools.result`); the server's hub replaces the hello's caps and records the machine's slots and Claude Code version; no answer |
| `runner.heartbeat` | `awakeMs` (monotonic since the runner started; stops while asleep), `load1`, `liveRuns[]` (run ids, ≤ 64), `backlog` (unacked events), `now`, `sample?` (`MachineSample`, once a minute) | every 20 s; renews the lease of each listed run |
| `runner.resync` | `runs[≤ 1000]{runId, state running\|exited\|gone, exitCode (int\|null), lastSeq}` | after every `server.hello` |
| `job.accept` | `id` (the offer), `runId` | → `run.start` |
| `job.decline` | `id`, `runId`, `reason` (1–500) | no slot, draining, harness missing |
| `run.events` | `events[1–100]{runId, seq ≥ 1, at, kind, data{}}` | journaled events; frame ≤ 64 KB (a runner cuts an event down to fit alone) → `run.ack` |
| `attention.create` | `id` (the runner's UUID, so a resend is one item), `runId`, `kind permission\|question\|blocked\|review\|failed`, `wait live\|next_turn`, `prompt`, `options[≤ 32]{id, label, description?}` | → later `attention.resolved` |
| `cmd.ack` | `cmdId`, `ok`, `error?` | once per command; a repeated `cmdId` is acked again without running it again |
| `hold.state` | `until` (ms\|null), `source server\|live_runs` | after each resync and on every change (below) |
| `power.result` | `cmdId`, `ok`, `status? running\|stopped\|starting\|stopping\|missing\|unknown`, `metadata?{}`, `error?` | the answer to `power.command` (instead of `cmd.ack`) |
| `tunnel.state` | `machineId` (the box), `state connecting\|up\|down`, `error?` (1–500 characters: the last line the tunnel printed) | a controller's tunnel changed (`connecting` at each start, `up` after 10 s alive, `down` when it ended; a `connecting` after a `down` keeps its error), and every tunnel's state again after each `server.hello`; no answer |
| `terminal.opened` | `sessionId`, `shell` (its path) | the shell of a `terminal.open` started; no answer |
| `terminal.output` | `sessionId`, `data` (base64 of 1 byte to 64 KB) | what the terminal printed, batched (about 16 ms or 32 KB) |
| `terminal.exit` | `sessionId`, `code` (int\|null), `signal?` (`SIGHUP`, …), `authJson?` (a harness terminal's rewritten Codex login, never relayed to the browser), `error?` (why the runner ended it or refused it: `terminal_unavailable`, `too_many_sessions`, `runner_stopping`, `runner_updating`, `idle_timeout`, `spawn_failed: …`) | the session ended (the shell exited, or it never started); nothing follows for it |
| `runner.update.result` | `cmdId`, `ok`, `build?` (the new build, when `ok`), `error?` (`<code>: <words>`, the code one of `RUNNER_UPDATE_ERRORS`: `unsupported`, `busy`, `download_failed`, `hash_mismatch`, `write_failed`) | the answer to `runner.update` (instead of `cmd.ack`); after an `ok` the runner restarts |
| `turn.events` | `turnId`, `events[1–100]{seq ≥ 1, event}` (`event` a `TurnEvent` of `@mwc/shared/harness`) | a chat turn's next events, in order (S5.1b, "Chat turns" below); no answer |
| `turn.question` | `turnId`, `seq ≥ 1` (its number among the turn's events), `questionId` (the runner's UUID), `questions` (1–4 `AskQuestion`s: `question`, `header`, `options[2–8]{label, description}`, `multiSelect`) | the agent called the runner's `ask_user_question` tool (S5.2 step 4, "Chat turns" below); no answer: the person's answer comes as the chat's next turn |
| `turn.tool` | `turnId`, `callId` (the runner's UUID), `tool` (one word of letters, digits and `_`, 1–64: an `AgentTool` of `@mwc/shared/flows`, or since S7.1c a server tool's name such as `getJiraIssue`), `input` (a JSON object: the tool's arguments as the runner checked them; `task_attach {path}` adds `file {path, contentType, size, sha256}`) | the agent called one of the turn's agents' tools (S6a, "Chat turns" below), after the turn's earlier events; answered by `turn.tool.result` |
| `fs.result` | `cmdId`, `ok`, `error?` (`<code>: <words>`, the code one of `FOLDER_ERRORS`), `path?` (resolved, absolute), and for a listing `parent?` (null at `/` and at the container's root), `entries?[≤ 500]{name, git, claudeMd}`, `truncated?`, `home?` (the runner user's home), `root?` (`/work` in a container, else null); for `fs.mkdirp` `created?` (false: the folder was there) | the answer to `fs.list`, `fs.mkdir` and `fs.mkdirp` (instead of `cmd.ack`; "Folders" below) |
| `tools.output` | `cmdId` (the install's), `line` (≤ 500 characters) | one line npm printed during a `tools.install` (both streams, at most 500 lines, then one notice); the server hands it to the request; no answer |
| `tools.result` | `cmdId`, `ok`, `tools?` (as `caps.tools`), `error?` (`<code>: <words>`, the code one of `TOOL_INSTALL_ERRORS`: `unsupported`, `busy`, `npm_missing`, `timeout`, `failed`) | the answer to `tools.check` and `tools.install` (instead of `cmd.ack`), after the versions were read again ("Tools" below) |
| `turn.artifact` | `turnId`, `index` (0–19, the file's number in the turn), `path` (its path in the outputs folder, ≤ 255, no `.`/`..` part), `contentType`, `size` (≤ 2 MB), `sha256`, `part` (from 0), `parts` (1–16), `data` (base64 of at most 128 KB), `callId?` (S6a: a file `task_attach {path}` sends, index 0, right before that call's `turn.tool`) | one part of a task step's collected file (S5.3b, "Artifacts" below), after the turn's last events; no answer |
| `turn.artifacts` | `turnId`, `files` (0–20), `skipped[≤ 50]{path, size, reason too_large\|binary\|too_many\|total_limit\|unreadable}` | what it collected and left out, after the last `turn.artifact`, before `turn.end`; no answer |
| `turn.end` | `turnId`, `ok`, `exitCode` (int\|null), `error?` (a `TURN_ERRORS` code, optionally `: ` and words), `authJson?` (a Codex login the process rewrote, a JSON object of at most 64 KB) | once per turn, after its last events (and a task step's artifacts); no answer |

## Server → runner

| Type | Fields | Notes |
|---|---|---|
| `server.hello` | `protocol`, `minRunnerVersion`, `machineId`, `resume?` (true from a server that takes held turns back, S5.4; left out by an older one) | no `update` (the signed self-update is S8; `runner.update` below is the SHA-256-checked one) |
| `job.offer` | `id`, `runId`, `agentId`, `expiresAt` | unaccepted for 30 s → offered again |
| `run.start` | `cmdId`, `spec` (below) | |
| `run.input` | `cmdId`, `runId`, `inputId`, `text` | mid-turn or next-turn message |
| `attention.resolved` | `cmdId`, `runId`, `attentionId`, `answer{optionIds?, text?, decision? allow\|deny\|deny_stop}` (at least one), `by` (principal) | |
| `run.stop` | `cmdId`, `runId`, `mode graceful\|kill` | graceful walks SIGINT, 20 s, SIGTERM, 10 s, SIGKILL |
| `run.ack` | `runId`, `ackedSeq` | highest contiguous seq stored; not a command |
| `key.rotate` | `cmdId`, `runnerKey` (`mwc_rk_…`) | the runner saves it before its ack |
| `runner.drain` | `cmdId` | no new runs until the runner restarts; live runs go on |
| `machine.hold` | `cmdId`, `until` (ms\|null) | null releases the server's hold |
| `power.command` | `cmdId`, `target{provider airia_devbox, ref{instance, zone, size?}}`, `action start\|stop\|status\|set_timezone`, `args?{timezone?}` | to a power controller; `set_timezone` needs `args.timezone` (IANA) |
| `tunnel.set` | `tunnels[≤ 64]{machineId, target{provider airia_devbox, ref}, remotePort, localPort, running?}` (ports 1–65535, one tunnel per machine; `running`, 2026-11-12: the box's last power reading says it runs, so the holder retries within 30 s and clears the box's port before each retry after a forward failure; left out by an older server, ignored by an older runner) | to a power controller: the full set of tunnels it should hold now (an empty one stops them all); not a command (no `cmdId`, no answer) |
| `terminal.open` | `sessionId` (the server's UUID), `cols` 2–500, `rows` 1–300, `harness?` (a `TerminalSpec`, S5.1b) | start a login shell in a new PTY, or with `harness` the harness's TUI on a chat's conversation; answered by `terminal.opened` or, refused, by `terminal.exit` |
| `terminal.input` | `sessionId`, `data` (base64 of 1 byte to 64 KB) | typed or pasted bytes |
| `terminal.resize` | `sessionId`, `cols`, `rows` | |
| `terminal.close` | `sessionId` | SIGHUP, SIGKILL 5 s later; `terminal.exit` follows |
| `runner.update` | `cmdId` | update yourself from the server you are linked to and restart; answered by `runner.update.result` ("Updating a runner") |
| `turn.start` | `turnId` (the server's UUID), `spec` (a `TurnSpec`: harness, cwd, prompt, sessionId, model, effort, permissionPolicy, `permissionMode?` (2026-11-13: the profile's mode or the chat's own; a runner older than it runs `permissionPolicy`: docs/harness.md "Modes"), configDir, credential, gateway, `instructions?` (the standing instructions, 2026-11-11; a runner older than it ignores it: docs/harness.md "Standing instructions"), `artifacts?` (`{dir}`: a task step's outputs folder under `cwd`, S5.3b; "Artifacts" below), `tools?` (S6a: the agents' tools the turn gets, by name, at most 32, each once; sent only to a runner with `caps.agentTools`), `serverTools?` (S7.1c: the server's own tools whole, at most 32 `{name, title, description, inputSchema, readOnly}`, each name once and none of the question tool's or the agents' tools'; sent only to a runner with `caps.serverTools`; docs/harness.md "Server tools")) | run one chat turn; answered by `turn.events` and one `turn.end` (S5.1b) |
| `turn.input` | `turnId`, `inputId` (the waiting turn's UUID), `text` (1–20 000 characters) | the person's message for the running turn (S5.2 step 6, "Chat turns" below); no answer: the harness's echo comes back as an `input` event with `inputId`, or nothing |
| `fs.list` | `cmdId`, `path` (absolute or `~/…`, 1–1024 characters; null for the default start) | the folders in a folder; answered by `fs.result` (S5.1d) |
| `fs.mkdir` | `cmdId`, `path` (absolute or `~/…`) | make one folder whose parent exists; answered by `fs.result` |
| `fs.mkdirp` | `cmdId`, `path` (absolute or `~/…`) | make a folder and its missing parents inside the runner's roots (2026-11-13, `caps.mkdirp`); answered by `fs.result` |
| `tools.check` | `cmdId` | look for the CLIs again and ask each one found its version; answered by `runner.caps`, then `tools.result` |
| `tools.install` | `cmdId`, `tool` (`claude` \| `codex`), `version` (an exact version: the server's pin) | install it with npm into `~/.local`; answered by `tools.output` lines, `runner.caps` and `tools.result` ("Tools" below) |
| `turn.stop` | `turnId` | stop it: SIGINT to its process group, SIGTERM 10 s later, SIGKILL 20 s after the SIGINT; its `turn.end` says `stopped` |
| `turn.resume` | `turns[≤ 256]{turnId, lastSeq}` (`lastSeq` the highest event number the server stored for the turn, or null: it has no such live turn; since 2026-11-12 a turn it had failed because its runner was away counts as live again when it takes it back) | once after `server.hello`, answering a hello that named turns (S5.4, "Chat turns" below): the runner resends the events after `lastSeq` and goes on; null: it stops that turn and forgets it |
| `turn.ack` | `turnId` | the server recorded the turn's end (S5.4); the runner removes the turn's run folder |
| `turn.tool.result` | `turnId`, `callId` (the `turn.tool`'s), `ok`, `text` (1–50 000 characters: what happened, or why not) | the answer to a `turn.tool` (S6a), which the tool returns to the agent (`ok: false` as a tool error); one for no waiting call is dropped (logged) |

**The run spec** (`RunSpec`): `runId`, `companyId`, `agentId`, `taskId` (null outside a task), `harness`,
`placement{home, configDir|null, worktree|null}` (absolute or `~/` paths), `session` (`{mode: 'new', sessionId|null}`
or `{mode: 'resume', sessionId}`), `model`, `effort`, `permissionPolicy ask|bypass`, `systemPrompt`,
`inputs[]{inputId, text}`, `secrets` (≤ 64 environment variables: the harness's environment only, stripped from
`spec.json`, never journaled), `runToken`, `limits{maxTurns?, maxDurationMs?}`. Big texts are bounded by the frame
limit alone.

## Semantics

- **Events.** `(runId, seq)` is assigned when an event is appended to the runner's journal, so a resend after a
  reconnect is a duplicate: the server inserts `ON CONFLICT DO NOTHING` and answers `run.ack` with the highest
  contiguous seq it holds; the runner forgets events up to it. At most 500 unacked events in flight over all runs; then
  the runner stops reading (its disk keeps everything).
- **Commands.** Every server frame with a `cmdId` is answered once, `cmd.ack` (or `power.result`, `runner.update.result`,
  `fs.result`, `tools.result`); duplicates after a reconnect are normal, and the runner remembers the `cmdId`s it ran (a folder listing
  is read again instead of kept). A runner older than a command acks it as unknown (`cmd.ack`, `ok: false`), which the
  server reads for `runner.update` as `unsupported` and for the folder and tools frames as `runner_outdated`.
- **Leases.** Each heartbeat sets `runs.lease_expires_at = now + 90 s` for the runs it lists. A lapse makes the run
  `lost` (never failed or cancelled) and the machine offline; the next resync reconciles: `running` stays running,
  `exited` is finalized from the journal, `gone` fails with `runner_lost_process` and is re-run in the same
  conversation.
- **Unknown frames and fields.** A frame of an unknown `type` is ignored, never an error; unknown fields pass through
  parsing untouched (the schemas are loose objects; their types list only the known fields).

## Hold and power

- **Hold** (`docs/machines.md`). The server decides from the machine's power policy (keep-on hours, `holdAfterTurnMin`)
  and sends `machine.hold{until}`; the runner acks and applies it with its driver: the devbox runs
  `devbox-keepalive '20 minutes'` (always that form) every 5 minutes, only when the current keepalive ends sooner;
  This Mac keeps one `caffeinate -i -w <runner pid>` child while held (when `keepMacAwake`), killed on release;
  a container does nothing. The runner also holds by itself while any run is live, through a server outage. It reports
  `hold.state{until, source}`: `until` is the end its driver guarantees (null when not held; a hold from live runs moves
  it at each refresh), `source` what set the state (`server`, or `live_runs` when runs started or the last one ended).
  When the hold ends the runner stops refreshing and the box's own idle policy takes over.
- **Power.** A box cannot start itself, so the server sends `power.command` to a **controller**: a connected runner
  whose `caps.power` has the target's provider (This Mac, with Ihor's own gcloud sign-in and the `airia` CLI). It runs
  `airia devbox up --no-wait`, `airia devbox stop`, `gcloud compute instances describe --format=json` for `status`, and
  `add-metadata devbox-tz=` for `set_timezone`, and answers `power.result` with the mapped status and metadata. Every
  decision and outcome is a `machine_power_events` row (`PowerEventAction`).
- **Power answers** (S4.4b). A controller's `power.result.metadata` is `{size, hourlyCost, rules}` (the devbox's size,
  dollars an hour and its own stop rules from its instance metadata; null when unknown), and its `error` is the
  driver's `<code>: <message>`, the code one of `@mwc/machines-core`'s `MACHINE_POWER_ERROR_CODES`. A `start` or `stop`
  that found the box already there (the driver ran no airia CLI) adds `already: true` to the metadata, and the power
  log says so ("…: the box was already on"); a runner without a
  power driver answers `no_power_driver`, which the server reads as `cli_missing`. A runner is a controller when the
  `airia` and `gcloud` executables are found (on the PATH, `/opt/homebrew/bin`, `/usr/local/bin` or
  `~/google-cloud-sdk/bin`, without starting a process); a missing gcloud sign-in shows on the first command.
- **When the server sends `machine.hold`** (S4.4b): each time a runner connects (its current hold, null included),
  whenever the scheduler's decision changes it (a step at most once a minute), and right after a policy change.
- **Tunnels** (2026-11-07). A devbox reaches the server only through a reverse SSH tunnel over Google IAP that its
  controller holds (`docs/machines.md`, "Installing a runner"). The server sends a controller (a connected runner with
  `airia_devbox` in `caps.power`) `tunnel.set` with every tunnel it wants: one per non-removed devbox of its company
  whose saved controller it is and whose last known power status is `running`, `starting` or not known yet (none for
  `stopped`, `stopping`, `missing`), each with `remotePort` and `localPort` the server's own listen port, so the box's
  `127.0.0.1:remotePort` leads to the controller's `127.0.0.1:localPort`. It sends the set when the controller says
  hello, after a devbox enrolls (its controller saved when exactly one connected runner of the company can power it),
  when a box's controller, removal or stored power status changes, and at every scheduler step as a safety net, but
  only when it differs from the set last sent on that connection (whether a box reads `running` counts). The runner
  reconciles each set: it starts the missing tunnels, stops the extra ones and restarts one whose target or ports
  changed (after the old one ended); a change of `running` alone restarts nothing. The devbox's tunnel is `gcloud compute
  ssh <instance> --project airia-devbox --zone <zone> --tunnel-through-iap --quiet --strict-host-key-checking=no -- -N
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ConnectTimeout=30 -o BatchMode=yes
  -R 127.0.0.1:<remotePort>:127.0.0.1:<localPort>` (gcloud by its full path; never `airia devbox ssh`, which starts a
  stopped box). It is started `detached` and stopped as a process group, SIGTERM then SIGKILL after 5 s, when it leaves
  the set and when the runner stops; one that ends while wanted starts again after 5 s, doubling to 5 minutes (30 s while
  its box reads `running`), from 5 s again after one that stayed up 60 s; the box's port is cleared first after a forward
  failure or the end of a tunnel that was up (docs/machines.md, "Tunnel recovery"). A runner without power, or one that cannot start processes,
  ignores `tunnel.set`. The server keeps the latest `tunnel.state` of each box in memory only (not the database) and
  shows it on the machine in `GET machines` as `tunnel{state, error, since}` when its saved controller reported it,
  null otherwise. When the server drives the airia CLI itself (MWC_LOCAL_POWER, `docs/machines.md`) it holds the
  tunnels in its own process and every controller's set is empty; no controller is sent `power.command` then.

## Terminal

Added 2026-11-09 (`runner-protocol/terminal.ts`; what it is for, who may open one and the browser's side are in
docs/machines.md, "Terminal"). A runner whose PTY loaded says `caps.terminal: true`; the server sends `terminal.open`
only to such a runner, relaying an owner's browser socket (`TERMINAL_WS_PATH`, `/api/terminal/ws`). The terminal frames
are no commands (no `cmdId`, no `cmd.ack`): `terminal.open` is answered by `terminal.opened`, then `terminal.output`
until `terminal.exit`, sent once per session, after its last output. Terminal bytes are base64 (`TerminalData`, at most
`TERMINAL_DATA_MAX_BYTES` decoded), so a character split between two frames stays whole. A session belongs to the
connection that carried its `terminal.open`: when the link drops the runner ends its shells (SIGHUP, SIGKILL 5 s later)
and the server ends their browser sockets (`error: 'machine_disconnected'`); nothing is resumed after a reconnect. The
runner refuses a `terminal.open` with `terminal.exit {code: null, error}`: `terminal_unavailable` (no PTY),
`runner_stopping`, `too_many_sessions` (`TERMINAL_SESSIONS_MAX`, 4), `spawn_failed: …`; a second `terminal.open` of an
open session is ignored, and input, resize or close of a session it does not have are ignored. It ends a session 60
minutes after its last input (`TERMINAL_IDLE_MS`; a notice line in the output, then `error: 'idle_timeout'`) and when it
stops (`runner_stopping`, sent before its socket closes). Open terminals count for its own hold as live runs do
(`hold.state` source `live_runs`). Output is batched (16 ms or 32 KB) and the PTY is paused while the socket's send
buffer is over 1 MB, until it is down to 256 KB.

## Chat turns

Added in S5.1b (`runner-protocol/turns.ts`, `turn.question` and `turn.input` in S5.2, a task step's `turn.artifact` and `turn.artifacts` in S5.3b ("Artifacts" below), `turn.tool` and `turn.tool.result` in S6a; how a turn runs end to end is docs/harness.md, "How a turn runs"). The server
sends `turn.start` only to a runner whose hello gave the harness's CLI version (`caps.harnesses`, read with
`harnessVersionOf`: undefined for a runner older than chats, which the server refuses as `runner_outdated`; null for a
missing CLI, `harness_missing`). The turn frames are no commands (no `cmdId`, no `cmd.ack`): `turn.start` is answered by
`turn.events` (zero or more, in order, each event numbered from 1 per turn), `turn.question` (zero or more, numbered
among the events) and exactly one `turn.end`, after the last events. The spec carries the credential the server resolved for this turn only; the runner never logs it, its
environment values or `auth.json`.

- **Refusals.** A start the runner does not carry out is answered at once with `turn.end {ok: false, exitCode: null,
  error}`, the codes of `TURN_ERRORS`: `unsupported` (no driver for the harness here, or no keeper), `busy` (`caps.slots` turns live),
  `home_missing` (the spec's `cwd` is not a folder on the machine; a container runner first makes a missing one under
  `/work`, `fs.mkdirp`'s rules), `invalid_spec: …` (the driver refused the spec),
  `spawn_failed: …` (the process or its private folder could not start), `runner_stopping`. A repeated `turn.start` of
  a live turn and a `turn.stop` of a turn it does not have are ignored.
- **The end.** `ok` is the turn's result's (false whenever there is an `error`), `exitCode` the process's (null after a
  signal), `error` `stopped` after `turn.stop`, `spawn_failed: …` when the harness could not start, and `process_lost`
  when its keeper ended without recording the exit (killed while no runner watched; S5.4). `runner_stopping` refuses a
  new turn only: a runner that stops leaves its turns running. `authJson` comes when a Codex process rewrote its `auth.json` (its own token refresh); the server seals it
  into the credential again.
- **Batching.** Events go about 100 ms after the first of a batch (`TURN_EVENTS_BATCH_MS`), or at once from 32 KB
  (`TURN_EVENTS_BATCH_BYTES`) or 100 events; a text event over 16 KB is split into several (each keeping its
  `parentId`) and a result's text is cut, so every frame fits the 256 KB frame limit (the other events are small by
  their limits: a thinking text at most 20 000 characters, a to-do list 100 items of 300).
- **Questions** (S5.2 step 4, docs/harness.md "Asking the person"). The runner gives each turn its MCP server
  (`runner.mjs mcp`) and a private Unix socket: the folder `<state>/turns/<12 hex>/` (0700) holds `ask.sock` (made
  before the process starts, gone with the folder when it ends) and the driver's files (Claude Code's `mcp.json`,
  0600); `MWC_ASK_SOCKET` and `MWC_ASK_TOKEN` (32 random bytes, hex) reach the MCP server through that file or, for
  Codex, its environment. On the socket each call is one line `{token, questions}` answered by one line `{ok: true,
  text}` or `{ok: false, error}` (a token compared in constant time, 64 KB a line, 10 s). A call the runner takes
  flushes the turn's waiting events, takes the next event number and sends `turn.question {turnId, seq, questionId,
  questions}`, so the events before it arrive first; the server stores it as the turn's `question` event. A call while
  the turn stops, or while the link is down, is answered as not shown; nothing is queued. Tool approvals (S6) are
  meant to ride the same socket.
- **Messages mid-turn** (S5.2 step 6, docs/harness.md "Delivery while a turn runs"). `turn.input {turnId, inputId,
  text}` goes to a running turn whose harness takes messages while it works (Claude Code's turns start with
  `--input-format stream-json --replay-user-messages`, the prompt as the first stdin line, stdin kept open). The runner
  writes it as one more user message (once per `inputId`); when the harness takes it, its echo is sent as an `input`
  event `{text, inputId}` among the turn's events, numbered in place. Stdin closes after a `result` once every message
  written was taken (or after 30 s of silence while one waits), so the process ends. A `turn.input` for no live turn,
  for a turn that takes no input (Codex), once it stops or after its stdin closed is dropped (logged); a runner older
  than the frame ignores it as an unknown frame. Either way the server sees no `input` event and starts the message as
  the next turn.
- **Agents' tools** (S6a, docs/harness.md "Agents' tools"). A runner that says `caps.agentTools` offers the tools a
  turn's spec names (`TurnSpec.tools`) on the same MCP server and socket as its question tool. A call goes as
  `turn.tool {turnId, callId, tool, input}` once the turn's earlier events are sent (it is not numbered among them), and
  the server answers `turn.tool.result {turnId, callId, ok, text}` on the connection that carries the turn; the runner
  waits 55 s. A file `task_attach {path}` attaches comes first as `turn.artifact` parts with the call's `callId`. The
  runner only relays: the server checks the tool, its input and who may do what. A call while the link is down is
  answered by the runner (nothing queued); one left waiting when the link drops is answered as possibly applied. An
  older server ignores `turn.tool` as an unknown frame; it never names tools, so a runner offers none.
- **The link** (S5.4; what each side does is docs/harness.md "Surviving restarts"). A turn outlives the connection
  that carried its `turn.start`. Each turn runs through a keeper in a run folder, and the runner keeps every event it
  numbered there before it sends it. When the link drops (or the runner restarts) the turn runs on and its frames wait;
  the runner's next hello names it in `turns` (id, last event number, whether its process ended), and the server answers
  once with `turn.resume`: per turn the highest event number it stored, after which the runner resends what follows from
  its log (`turn.events`, and a question as `turn.question` again; the server stores each event once, by `(turn, seq)`)
  and goes on live, and for a turn whose process ended sends its files and `turn.end` again; `lastSeq: null` (the server
  failed the turn, or never had it) makes the runner stop it by the ladder, send nothing, and remove its folder. The server
  keeps a turn whose runner says `caps.reattach` `running` and detached for its grace (`MWC_TURN_GRACE_SECONDS`, 30
  minutes since 2026-11-12, 180 s before) after the link drops, and at its own start waits the same grace for the turns
  left running; a hello of the machine that does not name a waiting turn ends it at once, the grace running out too
  (`machine_disconnected: <words naming the machine>`, `server_restarted`). Since 2026-11-12 a hello that names a turn
  the server so failed may still get a number in `turn.resume`: the server took it back (nothing else started in its
  chat, its task did not move), and the runner goes on with it as with any turn; the frames are unchanged. A stop asked
  while the turn is detached ends it at once on the server (`stopped`), so the runner coming back with it hears `null`.
  A runner without `caps.reattach` ended its processes with the link, so its turns fail at once, as before; a server
  without `server.hello.resume` sends no `turn.resume`, and the runner stops the turns it holds. `turn.ack` follows each recorded end; without it (an older server) the folder goes
  after 24 hours. Live turns count for the runner's own hold (`hold.state` source `live_runs`); they no longer make
  `runner.update` answer `busy`.

## Artifacts

Added in S5.3b (`runner-protocol/artifacts.ts`, the limits `ARTIFACT_LIMITS` and the type rule `artifactContentType` of
`@mwc/shared/flows`; what they are for is docs/processes.md "Built in S5.3b"). A turn of a task's step names an outputs
folder in its spec (`TurnSpec.artifacts.dir`, a relative path of plain names such as
`tasks/T-12/artifacts/2-code-review/round-1`). The runner:

1. before the process starts, makes that folder under the turn's `cwd` (the agent's home) and notes the files there
   (size and time); a folder that cannot be made, or whose real path leaves the home's, is not collected (logged) and the
   turn runs as usual;
2. when the process ends, after its last `turn.events` and before `turn.end`, collects the regular files new or changed
   since, in path order (hidden names and links passed over, 500 entries and 6 folders deep at most): up to 20 files, each
   at most 2 MB, 10 MB together, each one text (UTF-8 without a NUL byte; Markdown, JSON, CSV, HTML or plain by its
   extension, `; charset=utf-8`) or a PNG, JPEG, GIF or WebP image by its first bytes; the rest are skipped with why
   (`too_many`, `too_large`, `total_limit`, `binary`, `unreadable`; the first 50 listed);
3. sends each file as `turn.artifact` parts of 128 KB (an empty file is one empty part; base64 keeps every frame well
   under the 256 KB limit), then one `turn.artifacts` with the count and the skipped files, then `turn.end`.

The server's hub puts each file together from its parts (any order), drops one whose parts disagree (`path`, `size`,
`sha256`, `parts`), repeat, have the wrong length or would take the turn past 10 MB, checks the whole file's length and
SHA-256, and tells its type again from the bytes (a file that is not text or an image is dropped: the runner's
`contentType` is never trusted); parts still missing at `turn.end` are dropped. Both frames are optional both ways: a
runner older than them never sends them (the server keeps only the turn's hand-off note), and a server older than them
ignores them as unknown frames. A collection that fails on the runner is logged and the turn still ends.

## Updating a runner

Added 2026-11-09 (`runner-protocol/update.ts`; what Ihor sees and the server's other paths are in docs/machines.md,
"Updating a runner"). Two builds of one version say the same version (and every bundle said 0.1.0 before versioned
runners), so `runner.hello.build` (the SHA-256 of the `runner.mjs` the
runner was started from, hashed once at start; null from the sources) is how the server tells an old runner from a
current one. A runner says `caps.selfUpdate: true` only for the installed copy that launchd or systemd runs
(`MWC_RUNNER_SERVICE`) and restarts; the server sends `runner.update {cmdId}` only to such a runner, on a person's
click, and waits up to 3 minutes for `runner.update.result`. The runner:

1. answers `unsupported` without the capability; `busy` while it installs a tool or an update is under way; and `busy`
   while runs or terminals are live, unless the frame says `force: true` (its terminals then end with the notice of
   step 4); chat turns do not count since S5.4: they outlive the restart, and the restarted runner takes them back;
2. downloads `RUNNER_BUNDLE_PATH` and `RUNNER_PTY_PATH/<target>.tgz` from its own server address (http for ws, https
   for wss), each checked against `RUNNER_SHA256_HEADER` (`hash_mismatch` without one or on a mismatch; a 404 for the
   PTY keeps the one it has);
3. writes the bundle to a temporary file and the PTY (unpacked in memory, regular files under `node_modules/` only) to a
   staging folder beside the installed copy, moves the old `node_modules/` aside, the new one in, and renames the
   temporary bundle over `runner.mjs`; a failure puts the old copy back (`write_failed`);
4. ends its open terminals with a notice line and `terminal.exit` `error: 'runner_updating'`, answers `ok` with the new
   `build`, and 250 ms later stops (as on SIGTERM: terminals, socket 1000, hold, tunnels; its chat turns left running)
   and exits 75, which its service manager restarts (systemd `Restart=always`, `KillMode=process` so the turns' keepers
   stay; launchd `KeepAlive {SuccessfulExit: false}`). It reconnects as usual, says its new build and the turns it took
   back.

It trusts the server over its authenticated link and checks SHA-256 only; the signed self-update (Ed25519) is S8.

## Folders

Added 2026-11-09 for S5.1d (`runner-protocol/folders.ts`, the runner's `apps/runner/src/folders/`; what Ihor sees is in
docs/machines.md, "The folder browser"). The server reads a machine's folders through its runner to choose an agent's
home folder; folders only, never a file's contents, and nothing is deleted or renamed. A runner says `caps.folders: true`
when it has the browser; the server sends `fs.list` and `fs.mkdir` only to such a runner and waits 10 s
(`FOLDERS_TIMEOUT_MS`) for `fs.result`. `fs.mkdirp` (2026-11-13, after a hired agent's first message failed with
`home_missing` because its new folder did not exist) goes only to a runner that also says `caps.mkdirp`.

- **Paths.** `~` and `~/…` are the runner user's home; any other path must start with `/` (else `invalid_path`). `.`,
  `..`, repeated and trailing slashes are normalized away; a `..` that climbs above `/` is `invalid_path`. `fs.list`
  with `path: null` starts at the home, or at `/work` in a container.
- **A container** (`MWC_RUNNER_IN_CONTAINER=1` or `/.dockerenv`, on Linux) has one allowed root, `CONTAINER_WORK_ROOT`
  `/work`, its work volume: every path must be `/work` or under it, and the real path of the folder (links followed)
  must stay under the real `/work` (`outside_volume`). The home is outside it, so `~` is refused there.
- **`fs.list`** answers the folder's folders (links to folders count; dot-folders and files left out), sorted by name
  (case and numbers in human order), at most `FOLDERS_MAX` 500 with `truncated: true` past it, each with `git` (a `.git`
  folder or file in it) and `claudeMd` (a `CLAUDE.md` in it), plus `parent`, `home` and `root`.
- **`fs.mkdir`** makes one folder (mode 0755, less the umask) whose parent exists, never `/` or the root itself, and
  answers its resolved `path`.
- **`fs.mkdirp`** (`folders/mkdirp.ts`) makes a folder and its missing parents (`mkdir -p`, each 0755 less the umask, as
  the runner's user) only inside its allowed root: `/work` in a container, else the runner user's home. A path outside it
  (above it, or out of it by `..`) is `outside_volume` in a container and `outside_roots` elsewhere. The runner then
  resolves the real path of the nearest folder that exists (links followed): it must stay inside the root's real path
  (the same codes, "`<folder>` leads outside `<root>`"), it must be a folder (`not_a_directory`), and the missing folders
  are made under that real path. A folder already there is no error: `created: false`, nothing made. A container
  runner's turn uses the same rules for an agent's missing home folder (docs/harness.md, "How a turn runs").
- **Errors** (`FOLDER_ERRORS`): `not_found` (no folder, or for `fs.mkdir` no parent), `not_a_directory`,
  `permission_denied` (EACCES, EPERM), `outside_volume`, `outside_roots` (`fs.mkdirp` outside the user's home), `exists`, `invalid_path`, `unsupported` (a runner without the
  browser), `failed` (any other file system error, with its words). The server answers them as 422s in plain words,
  `not_found` as `folder_not_found` and `exists` as `folder_exists` (docs/machines.md); an older server reads
  `outside_roots` as `failed`.

## Tools

Added 2026-11-10 (`runner-protocol/tools.ts`, the runner's `apps/runner/src/tools/`; what Ihor sees and the server's
routes are in docs/machines.md, "Tools"). A runner says the CLIs it found in `caps.tools` (`RunnerTools`: `claude`,
`codex`, `git`, `gh`, `docker`, each its `--version`'s first line or null; a CLI a side does not know yet is null and a
newer one passes through). The server sends `tools.check` and `tools.install` only to a runner that says `caps.tools`.

- **`tools.check {cmdId}`**: the runner looks for every CLI again (no process for a missing one, one `--version` per
  found one), has its harnesses look again for a harness CLI found now (so a turn drives it and `caps.harnesses` says
  it), sends `runner.caps` and then answers `tools.result {ok: true, tools}`. The server waits 45 s
  (`TOOLS_CHECK_TIMEOUT_MS`).
- **`tools.install {cmdId, tool, version}`**: `tool` is `claude` or `codex` (`InstallableTool` of `@mwc/shared/machines`),
  `version` an exact version (`PackageVersion`: `2.1.308`, `1.0.0-beta.1`; never a range or a tag), the server's pin
  (`TOOL_PACKAGES`). The runner refuses it with `tools.result {ok: false, error}` when it cannot install here
  (`unsupported`: a container, or no way to start a process), while another install runs or it updates itself (`busy`), and without an npm
  beside its Node (`npm_missing`). Otherwise it runs `<node's folder>/npm install -g --prefix <home>/.local
  <package>@<version>` as its user from its home, in its own process group, with npm's folder first on the PATH and no
  `MWC_*` variable; every line npm prints on either stream is sent as `tools.output {cmdId, line}` (cut to
  `TOOL_OUTPUT_LINE_MAX`, 500 characters; after `TOOL_OUTPUT_LINES_MAX`, 500 lines, one notice and nothing more); after
  `TOOLS_INSTALL_TIMEOUT_MS` (10 minutes) the group gets SIGKILL (`timeout`). When npm ends it reads the versions again
  as a check does, sends `runner.caps`, and answers `tools.result {ok, tools, error?}` (`failed: npm exited with code N
  (<its last line>)` on a failure). A repeated `cmdId` gets the remembered answer; a runner that stops kills an install
  under way. The server waits the runner's 10 minutes and one more.
- **`runner.caps {caps}`** carries the whole caps again; it comes before the answer, so the server's view is current
  when the answer arrives.

## Limits and timers

| Constant | Value |
|---|---|
| `RUNNER_PROTOCOL_VERSION`, `RUNNER_SUBPROTOCOL`, `RUNNER_WS_PATH` | 1, `mwc-runner.v1`, `/api/runner/ws` |
| `RUNNER_FRAME_MAX_BYTES` | 256 KB |
| `EVENT_BATCH_MAX_EVENTS`, `EVENT_BATCH_MAX_BYTES` | 100 events, 64 KB |
| `RUNNER_PING_MS`, `RUNNER_HEARTBEAT_MS` | 20 s each |
| `RUN_LEASE_MS` | 90 s |
| `JOB_OFFER_TTL_MS` | 30 s |
| `UNACKED_EVENTS_MAX` | 500 |
| `MACHINE_SAMPLE_MS` | 60 s |
| `DEVBOX_KEEPALIVE_REFRESH_MS`, `DEVBOX_KEEPALIVE_DURATION` | 5 min, `'20 minutes'` |
| `RUNNER_HELLO_TIMEOUT_MS` | 10 s |
| `KEY_ROTATION_OVERLAP_MS` | 10 min |
| `TUNNELS_MAX`, `TUNNEL_ERROR_MAX` | 64 tunnels in one `tunnel.set`, 500 characters of a `tunnel.state` error |
| `TERMINAL_DATA_MAX_BYTES`, `TERMINAL_COLS`, `TERMINAL_ROWS` | 64 KB decoded per `terminal.input` / `terminal.output`; cols 2–500, rows 1–300 |
| `TERMINAL_SESSIONS_MAX`, `TERMINAL_IDLE_MS`, `TERMINAL_TICKET_TTL_MS` | 4 terminals per machine, 60 minutes without input, 60 s for a browser ticket |
| `TURN_EVENTS_BATCH_MS`, `TURN_EVENTS_BATCH_BYTES` | a turn's events sent 100 ms after the first of a batch, or at once from 32 KB (or 100 events) |
| `TURN_STOP_TERM_MS`, `TURN_STOP_KILL_MS` | SIGTERM 10 s and SIGKILL 20 s after a stopped turn's SIGINT |
| `HELD_TURNS_MAX`, `TURN_REATTACH_GRACE_MS` | 256 turns in one hello or `turn.resume`; a turn whose runner went away waits 30 minutes for it (the server's `MWC_TURN_GRACE_SECONDS`; 180 s before 2026-11-12) |
| the runner's turns (`apps/runner/src/turns/`) | the journal read every 100 ms; a keeper alone 10 minutes closes the harness's stdin; 2 s for a keeper's greeting; an ended turn's folder kept 24 h without `turn.ack` |
| `TURN_TOOLS_MAX`, `TOOL_RESULT_MAX` (`@mwc/shared/flows`), the runner's waits | 32 tools a turn names, 50 000 characters of a `turn.tool.result`; the runner waits 55 s for it, the MCP server 60 s for the runner |
| `ARTIFACT_LIMITS` (`@mwc/shared/flows`), `ARTIFACT_PARTS_MAX` | a task step's turn collects 20 files of at most 2 MB, 10 MB together, 50 skipped listed, names of 255 characters, sent in parts of 128 KB (16 at most per file) |
| the runner's terminals (`apps/runner/src/terminal/`) | output sent 16 ms after its first byte or at 32 KB; PTY paused over 1 MB queued, resumed at 256 KB; SIGKILL 5 s after SIGHUP |
| the tunnels' supervisor (`packages/machines-core/src/tunnels.ts`, the runner's and the server's) | up after 10 s alive; restart after 5 s doubling to 5 min, reset after 60 s up; SIGKILL 5 s after SIGTERM |
| the self-update (`apps/runner/src/update/`, the server's `service/runner/update.ts`) | 3 minutes for the runner's answer, 2 minutes per download, the restart 250 ms after the answer, exit code 75 |
| `FOLDERS_MAX`, `FOLDERS_TIMEOUT_MS` | 500 folders in one `fs.result`, 10 s for the runner's answer |
| `TOOLS_CHECK_TIMEOUT_MS`, `TOOLS_INSTALL_TIMEOUT_MS`, `TOOL_OUTPUT_LINE_MAX`, `TOOL_OUTPUT_LINES_MAX` | 45 s for a check's answer, 10 minutes for npm (the server waits a minute more), 500 characters per output line, 500 lines per install |
| `RUNNER_CLOSE` | 1009 frame too large, 4001 unauthorized (key revoked or machine removed while connected), 4002 unsupported protocol, 4003 runner too old, 4004 replaced, 4008 hello timeout |

## Reading and writing frames

`parseRunnerFrame(text)` (the server's side) and `parseServerFrame(text)` (the runner's) check the size, parse the
JSON and validate the frame of its `type`. They return `{kind: 'frame', frame}`, `{kind: 'unknown', type}` (ignore it),
or `{kind: 'invalid', error}` with a `FrameError` whose `code` is `too_large`, `not_json`, `not_object`, `no_type` or
`invalid` (with the schema's `issues`). `encodeFrame(frame)` returns the text and throws a `too_large` FrameError over
the frame's limit. For tests, `@mwc/testkit/runner` has `FakeRunnerServer` (for the runner's tests) and `FakeRunner`
(for the hub's), both over real sockets on 127.0.0.1.

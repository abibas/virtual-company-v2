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
while the process stays up, so two copies of one machine never take turns. In development the devbox reaches the server
at `wss://<ngrok static domain>/api/runner/ws`.

**Auth tiers** (Buildkite style). An admin makes a one-time **enrollment token** (`mwc_et_…`, expires); `mwc runner
install --token` trades it at `POST /api/runner/enroll` for the machine's id and its **runner key** (`mwc_rk_` + 32
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
| `runner.hello` | `protocol` (int ≥ 1), `version` (semver), `caps{harnesses[], slots 0–64, hold devbox_keepalive\|caffeinate\|none, power[] of airia_devbox}`, `claudeVersion?` (`claude --version`, 1–100 characters, or null; S4.2) | first frame; `power` lists the providers it can drive (`airia` and `gcloud` present and signed in); a hello without `claudeVersion` keeps the version on record → `server.hello` |
| `runner.heartbeat` | `awakeMs` (monotonic since the runner started; stops while asleep), `load1`, `liveRuns[]` (run ids, ≤ 64), `backlog` (unacked events), `now`, `sample?` (`MachineSample`, once a minute) | every 20 s; renews the lease of each listed run |
| `runner.resync` | `runs[≤ 1000]{runId, state running\|exited\|gone, exitCode (int\|null), lastSeq}` | after every `server.hello` |
| `job.accept` | `id` (the offer), `runId` | → `run.start` |
| `job.decline` | `id`, `runId`, `reason` (1–500) | no slot, draining, harness missing |
| `run.events` | `events[1–100]{runId, seq ≥ 1, at, kind, data{}}` | journaled events; frame ≤ 64 KB (a runner cuts an event down to fit alone) → `run.ack` |
| `attention.create` | `id` (the runner's UUID, so a resend is one item), `runId`, `kind permission\|question\|blocked\|review\|failed`, `wait live\|next_turn`, `prompt`, `options[≤ 32]{id, label, description?}` | → later `attention.resolved` |
| `cmd.ack` | `cmdId`, `ok`, `error?` | once per command; a repeated `cmdId` is acked again without running it again |
| `hold.state` | `until` (ms\|null), `source server\|live_runs` | after each resync and on every change (below) |
| `power.result` | `cmdId`, `ok`, `status? running\|stopped\|starting\|stopping\|missing\|unknown`, `metadata?{}`, `error?` | the answer to `power.command` (instead of `cmd.ack`) |

## Server → runner

| Type | Fields | Notes |
|---|---|---|
| `server.hello` | `protocol`, `minRunnerVersion`, `machineId` | no `update` (the signed self-update is S8) |
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
- **Commands.** Every server frame with a `cmdId` is answered once, `cmd.ack` (or `power.result`); duplicates after a
  reconnect are normal, and the runner remembers the `cmdId`s it ran.
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
| `RUNNER_CLOSE` | 1009 frame too large, 4001 unauthorized (key revoked or machine removed while connected), 4002 unsupported protocol, 4003 runner too old, 4004 replaced, 4008 hello timeout |

## Reading and writing frames

`parseRunnerFrame(text)` (the server's side) and `parseServerFrame(text)` (the runner's) check the size, parse the
JSON and validate the frame of its `type`. They return `{kind: 'frame', frame}`, `{kind: 'unknown', type}` (ignore it),
or `{kind: 'invalid', error}` with a `FrameError` whose `code` is `too_large`, `not_json`, `not_object`, `no_type` or
`invalid` (with the schema's `issues`). `encodeFrame(frame)` returns the text and throws a `too_large` FrameError over
the frame's limit. For tests, `@mwc/testkit/runner` has `FakeRunnerServer` (for the runner's tests) and `FakeRunner`
(for the hub's), both over real sockets on 127.0.0.1.

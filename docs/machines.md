# Machines: where agents live, keeping them alive, and their stats

Design approved by Ihor on 2026-11-06 (S4). Decisions he made: the devbox runner reaches the server through an ngrok static domain in development; This Mac is kept from idle-sleeping while runs are live or held. Auto-start switches are off until he turns them on.

## Context

Ihor (2026-11-06), before S4 starts: agents live on This Mac, in a Docker container, or on a remote machine — for him
the **Airia devbox**, spawned with his company's `airia` CLI ("the plugin"). Machines go down by themselves (the box's
idle policy), so something must keep a machine alive while it is needed, with wake-up / shut-down rules, and the home
dashboard needs a **Machines** board like v1's (Load/CPU, CPU, memory, disk, runtime 24 h / 7 d, agent runs 24 h,
a load sparkline, up/down bars, overloaded share). He asked to look at how it is done today and choose the best way.

How it is done today (research, 2026-11-06):
- **v1** (the earlier product, a read-only reference): the server does everything from the Mac over SSH through
  Google IAP — starts/stops the box with `gcloud compute instances start|stop`, pushes
  `devbox-keepalive '20 minutes'` over SSH every 5 min and at each run (`'20m'` silently wrote nothing once), pulls
  stats every 60 s with one SSH command, keeps runs alive with detached `setsid` + `tail` reconnects + `sleep`
  stand-ins, and holds reverse tunnels for callbacks. Policy: keep-on hours + TZ, chat hold 45 min, opt-in auto-start
  at hours / on work / on a message, stop at the hours' end; a policy table, a power events table and load samples
  kept 7 days. Recorded
  pain: dead IAP tunnels killing runs (exit 255), Mac sleep lapsing leases, stale tunnel ports, stand-ins outliving
  restarts, ~600 `ps`/min burning Kandji CPU, nothing keeping the Mac awake, most of it untested.
- **Airia CLI** (`/Users/abibas/LAST_DANCE/AIRIA CLI`, `libexec/airia-devbox`): a bash wrapper over `gcloud`
  (project `airia-devbox`, box `dev-<you>`, no public IP, IAP SSH only, Cloud NAT outbound). `up --no-wait` re-pushes
  the box scripts and starts it (or creates it); `stop`; `status`/`list` are text only (no JSON) — `gcloud compute
  instances describe --format=json` gives status and metadata. On the box, `devbox-idle-check` (systemd, every 5 min)
  halts it after 45 min idle in work hours / 20 min otherwise, plus a nightly stop 20:00–08:00 in `devbox-tz`;
  activity = a login session, claude-hub use, load1 > 0.5, or **the keepalive file** `/var/lib/devbox/keepalive`
  (epoch), written by `devbox-keepalive '<GNU date duration>'`. Sizes s/m/l/xl = $0.134–1.073/h (default m $0.268/h).

## The choice: one runner on every machine; the server decides, the runner acts

The "script pushed like MDM" is the planned **runner daemon**, installed once per machine as a service (launchd on
the Mac, `systemd --user` + linger on the box, PID 1 in a container). It dials **out** to the server (WSS), so the
server never SSHes, holds no tunnels and no stand-in processes. Everything v1 pulled over SSH, the runner does
locally:

| Job | Who | How |
|---|---|---|
| Policy (keep-on hours, hold after a turn, auto-start rules, stop at the hours' end) | server | per-machine policy rows + a 60 s scheduler job; every decision logged with its reason |
| Keep the machine awake | the runner **on that machine** | server sends `hold until T`; the runner also holds by itself while any run is live (survives a server outage). Devbox: `devbox-keepalive '20 minutes'` every 5 min, only when the current hold is shorter. Mac: one `caffeinate -i -w <runner pid>` child while held (Ihor: while runs or a hold), killed on release. Container: nothing. When the hold ends the runner stops refreshing and the box's own idle policy takes over (company policy stays the backstop). |
| Start / stop a stopped box (it can't start itself) | a **power controller**: the runner on This Mac | it has Ihor's own gcloud sign-in and the `airia` CLI (no credentials copied into the app, v1's trust model): `airia devbox up --no-wait`, `airia devbox stop`, status/metadata via `gcloud ... describe --format=json`, time-zone fix via `gcloud ... add-metadata devbox-tz=`. In the cloud later the controller is a container runner with a service account — same protocol. |
| Stats | the runner on that machine | a sample every 60 s in the heartbeat (Node `os`: loadavg, CPU % from `os.cpus()` deltas, uptime; `fs.statfs` for disk; memory on macOS `sysctl kern.memorystatus_level`, on Linux `/proc/meminfo` MemAvailable); no SSH, one `sysctl` start per minute at most on the Mac |
| Reaching the server from the box | box runner | `wss://<ngrok static domain>/api/runner/ws` in development (Ihor's choice: ngrok, a reserved static domain so the address never changes), the real domain after S8 |

Machine kinds: `laptop` (This Mac: no remote power; shows "asleep · last seen" when heartbeats stop), `container`
(Docker, always on while its host is), `vm` with provider `airia_devbox` (power through the controller). Defaults
never start a machine: auto-start switches are off until Ihor turns them on (v1 rule: starting costs money).

## Data model (migration 0009_machines, tenant tables)

- `machines`: name, kind (`laptop|vm|container`), provider (`none|airia_devbox`), provider_ref (jsonb: instance, zone,
  size), controller_machine_id (nullable, composite FK), os, arch, hostname, unix_user, runner_version,
  claude_version, slots, status (`online|offline|draining`), last_seen_at, hourly_cost.
- `enrollment_tokens` (sha256, expires_at, used_at, created_by); runner keys are the existing `api_keys(kind=runner,
  machine_id)`.
- `runner_sessions` (machine, connected_at, disconnected_at, version, remote_ip) — the up/down source.
- `machine_samples` (PK `(company_id, machine_id, at)` per minute: load1/5/15, cpus, cpu_pct, mem_pct, disk_used,
  disk_total, uptime_s, live_runs), 7-day retention (hourly prune in the jobs loop).
- `machine_power` (one row per machine, PK `(company_id, machine_id)`): policy jsonb (zod `MachinePowerPolicy` in
  `@mwc/shared`, v1's shape: keepOn{enabled, days, from, to, timezone} default off Mon–Fri 09–19 Europe/Kyiv,
  holdAfterTurnMin 45, keepMacAwake true, autoStartAtKeepOn/onWork/onMessage false, stopAtKeepOnEnd true), state jsonb.
- `machine_power_events` (action started|stopped|held|released|kept|policy|timezone|failed, reason, actor
  `user:<id>|schedule|auto|system`).

## Protocol additions (`@mwc/shared/runner-protocol.ts`, on top of the planned v1 protocol)

- `runner.hello.caps` + `hold: devbox_keepalive|caffeinate|none`, `power: ['airia_devbox']` (when `airia` and
  `gcloud` are present and signed in).
- `runner.heartbeat` (20 s) + `sample` once a minute.
- server → runner `machine.hold {cmd_id, until|null}`; runner → server `hold.state {until, source}`.
- server → controller `power.command {cmd_id, target{provider, ref}, action start|stop|status|set_timezone, args}` →
  `power.result {cmd_id, ok, status, metadata, error}`.

## Code placement (per the keep-structure skill)

- `packages/machines-core`: the `MachinePowerDriver` port (`discover`, `status`, `start`, `stop`, `setTimezone`) and a
  fake. `connectors/machine-airia-devbox`: implements it by spawning `airia` / `gcloud` (spawn injected; tests with
  recorded JSON and a fake spawn). Loaded by the runner, never by the server.
- `apps/runner`: link, heartbeat + sampler, hold drivers (`hold/devbox.ts`, `hold/caffeinate.ts`), controller
  executing `power.command` through the connector.
- `apps/server/src/modules/machines/`: routes, service, repo, `rules/power.ts` (pure: keep-on window incl. overnight
  and TZ, hold-until, once-per-window auto-start where a manual Stop sticks, stop at the end only without live work),
  `rules/stats.ts` (overloaded = load1/cpus > 1.0 or CPU > 85 %; badge when overloaded now or > 50 % of 24 h; 5-min
  bucket means; up/down segments from sessions + power events; runtime = online time; agent runs 24 h = sum of run
  durations, "—" until S5). Scheduler + prune as jobs in `platform/jobs`. Logic ported from v1
  v1's power and load-stats services as design, rewritten with tests.
- API under `/api/companies/:companyId/`: `machines` (list/get/rename/remove), `machines/enrollment-tokens`,
  `machines/:id/power` (GET/PUT policy, POST start|stop|timezone — admins and owners; viewers read only),
  `machines/:id/events`, `machines/stats` (the board); `POST /api/runner/enroll`, `GET /api/runner/ws`.
- Web: `/:slug/machines` (`pages/company/MachinesPage.tsx`, `features/machines/`): a card per machine — status,
  agents on it, the stats row, Start/Stop with the hourly cost (devbox), the Power form (keep-on hours, days, from/to,
  time zone, start when hours begin, stop when they end, hold minutes, keep This Mac awake, start on message / on work
  marked "from S5"), the box's own rules read-only with "Set the box's time zone to X", the last 10 log entries;
  **Add a machine** sheet: kind → a one-time enrollment token and the exact install command (Mac:
  `curl … install.sh | sh -s -- …`; devbox: `airia devbox ssh -- '<install>'` for Ihor to run; container: compose
  command), as "Installing a runner" below has them (`publicUrl` of `GET /api/config` for the devbox's address).
  Home `/:slug`: **Machines** widget under the limits widget, one row per machine as in his screenshot, refreshed
  every minute; new library pieces `components/data/Sparkline.tsx` (dashed threshold line) and `UpDownBar.tsx`.

## Installing a runner

Built in S4.5. A runner is one JavaScript file, `apps/runner/dist/runner.mjs` (`pnpm --filter @mwc/runner build`,
esbuild, Node 22 or newer, every dependency inside; `mwc check --full` builds it too), that runs the daemon (`run`) and
installs itself (`enroll`, `install`, `status`, `uninstall`; `node runner.mjs help`). The server hands it out:
`GET /api/runner/runner.mjs` (404 `runner_bundle_missing` until it is built; its SHA-256 in `x-mwc-runner-sha256`) and
`GET /api/runner/install.sh`, a POSIX script that checks for Node 22 and curl, downloads the bundle to a temporary
folder, checks its SHA-256 and runs `node runner.mjs install` with its own arguments. Both are public: the enrollment
token is the secret. Nothing is installed by the repository's tooling; each install is a person's own step.

**1. A token.** An admin or owner makes one (good for one machine within the hour), and `mwc` prints the command for
each kind of machine with it:

```sh
pnpm mwc machine enroll-token [--company <slug>]
```

**2. The command, on the machine.**

| Machine | Command | What it installs |
|---|---|---|
| This Mac | `curl -fsSL <url>/api/runner/install.sh \| sh -s -- --server <url> --token mwc_et_…` | a launchd agent |
| Airia devbox | `airia devbox ssh -- 'curl -fsSL <public url>/api/runner/install.sh \| sh -s -- --server <public url> --token mwc_et_…'` (Ihor runs it; the box costs its hourly rate while up) | a systemd user unit |
| Docker container | `MWC_ENROLL_TOKEN=mwc_et_… docker compose -f deploy/compose.yml --profile runner up -d runner-local` (from the repository folder) | the `runner-local` service |

The devbox reaches the server only at its public address: `MWC_PUBLIC_URL` set to the ngrok static domain (then
`GET /api/config` answers it as `publicUrl`, null while it is unset, and `mwc machine enroll-token` puts it in the
devbox's command). The box needs Node 22 on the PATH of a non-interactive SSH command; a Node from nvm needs
`. ~/.nvm/nvm.sh &&` in front of `curl`.

**What `install` does.** `install --server <url> --token <mwc_et_…> [--name <name>] [--slots <n>] [--force]`:

1. Refuses first, before the token is used: a system other than macOS or Linux, a container, a runner run from its
   sources instead of `runner.mjs`, a machine already enrolled (`--force` enrolls it again as a new machine).
2. Enrolls (`POST /api/runner/enroll`): the kind (macOS `laptop`; `/.dockerenv` or `MWC_RUNNER_IN_CONTAINER=1`
   `container`; else `vm`), the system, architecture, host name, Unix user, the runner's version, Claude Code's
   version (one `claude --version`, only when `claude` is on the PATH) and the provider: a machine with
   `/usr/local/bin/devbox-keepalive` whose GCE metadata server names its instance, zone and project (1 s at most) is
   `airia_devbox`. The name is `--name`, else `Airia devbox`, else the short host name. 2 slots unless `--slots`.
   The id and the runner key go to `~/.config/mwc/runner.json` (0600 in a 0700 folder).
3. Copies itself to `~/.local/share/mwc-runner/runner.mjs` and starts it as a service with the Node that installed it
   and a short PATH (Node's folder, the folders of `claude`, `git`, `gh`, `docker`, `airia` and `gcloud` found on the
   installer's PATH, the system's):
   - **macOS:** `~/Library/LaunchAgents/com.mwc.runner.plist` (RunAtLoad, KeepAlive while it fails, ThrottleInterval
     10, its log `~/.local/state/mwc-runner/runner.log`), loaded with `launchctl bootstrap gui/<uid>` (from a Terminal
     of the desktop session). launchd cannot leave a service stopped after chosen exit codes, so under launchd the
     runner exits 0 after a refused key (77), a runner too old (76) or a broken configuration (78) and stays stopped
     until it is installed again.
   - **Linux:** `~/.config/systemd/user/mwc-runner.service` (Restart=always after 10 s, `RestartPreventExitStatus=76
     77 78`, 90 s to stop), `loginctl enable-linger` (or `sudo -n`, else a warning: the runner then stops at logout),
     `systemctl --user daemon-reload` and `enable --now`; its log is `journalctl --user -u mwc-runner.service`.

Run again without `--token`, `install` keeps the enrollment and reinstalls the service on the new bundle (a restart).
`node ~/.local/share/mwc-runner/runner.mjs status` shows the enrollment, the service file and what the runner's health
endpoint (127.0.0.1:9953) says, and exits 0 only when it is connected; `uninstall` removes the service and the
installed copy and keeps `runner.json` (`--purge` removes it and the state folder); the machine stays on the server until
it is removed on the Machines page.

**The container** (`deploy/Dockerfile.runner`): Node 24 slim, git, tini as PID 1, the bundle, the user `runner`, its
state and `runner.json` in the volume `/var/lib/mwc-runner`. Started without a `runner.json` and with
`MWC_ENROLL_TOKEN` and `MWC_SERVER_URL`, the runner enrolls itself (kind `container`, named by `MWC_RUNNER_NAME`,
`runner-local` in compose), then runs; later starts reuse the enrollment. The `runner-local` service is behind the
compose profile `runner` (plain `docker compose up` still starts the dev Postgres only), reaches the dev API at
`http://host.docker.internal:9950` (`MWC_SERVER_URL` overrides it), has a health check on 9953 and 90 s to stop.
`docker compose -f deploy/compose.yml down` (what `mwc dev --down` runs) may stop it too; the same `up` command starts
it again without a token. The image has no Claude Code yet (S5).

## Stage plan (S4)

| Wave | Step | Size / effort | Notes |
|---|---|---|---|
| 1 | S4.1 protocol + shared zod (policy, samples, power) + testkit fake server / fake runner | large / xhigh | the contract every later brief cites |
| 2 | S4.2 server: migration 0009, enrollment, WS hub, sessions, samples ingest + prune, machines + stats API | large / xhigh | server merge: dev API restarts + migrate; announce first |
| 2 | S4.3 `apps/runner` core: config, state dir, link + reconnect, heartbeat + sampler, hold drivers, health :9953 | large / xhigh | parallel with S4.2 |
| 2 | S4.4a `packages/machines-core` + `connectors/machine-airia-devbox` | medium / high | parallel; no server files |
| 3 | S4.4b power: scheduler, policy rules, power API, controller routing, events | large / xhigh | after S4.2 + S4.3 |
| 3 | S4.5 `mwc runner install` (launchd plist, systemd user unit + linger, container) + `mwc machine enroll-token` + compose `runner-local` + `deploy/Dockerfile.runner` | medium / high | |
| 3 | S4.6 web: Machines page + home Machines widget | medium / high | from the S4.2/S4.4b API contract |
| 4 | S4.7 placements: an agent's machine and mode (`host` folder / fresh `container` per run) on the agent form | medium / high | the container spawn args (v1's locked-down `docker run`) are used by S5's runs |
| 4 | S4.8 structure review → tag v0.5.0 | small / main | |

Moved out of S4: the runner's signed self-update (to S8; not needed for the SLOP BOX milestone). The devbox's agent
runs, worktrees and the "Waking up…" chat banner come with S5 (runs), using this power layer.

## Verification

- Tests (server coverage rule; no web tests): protocol zod round-trips; hub on PGlite with `ws` (connect, heartbeat
  moves `last_seen_at`, samples stored, disconnect → offline, cross-tenant 404, viewer can't power); runner against
  the fake server (server restart survived, reconnect backoff, awake-time gaps); sampler with injected `os`; hold
  drivers with a fake spawn (never shortens the keepalive, always `'20 minutes'` form, caffeinate killed on release
  and on runner exit); power rules (overnight windows, time zones, auto-start once per window, manual stop sticks,
  no stop with live work); connector with recorded `gcloud` JSON; stats math (overloaded, buckets, up/down, runtime).
- `pnpm mwc check` per step, `--full` before the tag.
- Live, each step with Ihor's OK: ngrok static domain + `MWC_PUBLIC_URL`; runner on This Mac as a launchd service;
  compose `runner-local`; runner on the devbox installed once with `airia devbox ssh` (the box costs its hourly rate
  while up); all three online on the Machines page and on the home widget with live numbers; server restart → all
  reconnect and samples continue; Start / Stop the box from the page; keep-on window → keepalive file extended and the
  "held" log entry; This Mac's hold visible in `pmset -g assertions`; hold ends → box stops by its own policy.

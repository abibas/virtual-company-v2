# Machines: where agents live, keeping them alive, and their stats

Design approved by Ihor on 2026-11-06 (S4). Decisions he made: the devbox runner reaches the server through an ngrok static domain in development (replaced on 2026-11-07, at his pointer to the airia CLI, by a reverse SSH tunnel over Google IAP that This Mac's runner holds: "Installing a runner"); This Mac is kept from idle-sleeping while runs are live or held. Auto-start switches are off until he turns them on. On 2026-11-09 he decided that the devbox page is driven by the airia CLI and that the server uses it directly when it runs on a Mac that has `airia` and `gcloud` (his development setup), so no runner on This Mac is needed to power the box or hold its tunnel ("The server as the power controller").

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
server never SSHes into a machine and holds no stand-in processes (the devbox's one tunnel is held by its power
controller, below: in development the server itself). Everything v1 pulled over SSH, the runner does locally:

| Job | Who | How |
|---|---|---|
| Policy (keep-on hours, hold after a turn, auto-start rules, stop at the hours' end) | server | per-machine policy rows + a 60 s scheduler job; every decision logged with its reason |
| Keep the machine awake | the runner **on that machine** | server sends `hold until T`; the runner also holds by itself while any run is live (survives a server outage). Devbox: `devbox-keepalive '20 minutes'` every 5 min, only when the current hold is shorter. Mac: one `caffeinate -i -w <runner pid>` child while held (Ihor: while runs or a hold), killed on release. Container: nothing. When the hold ends the runner stops refreshing and the box's own idle policy takes over (company policy stays the backstop). |
| Start / stop a stopped box (it can't start itself) | a **power controller**: in development **the server itself** (MWC_LOCAL_POWER, below); a runner controller (the runner on This Mac) only for a server without the tools | it has Ihor's own gcloud sign-in and the `airia` CLI (no credentials copied into the app, v1's trust model): `airia devbox up --no-wait`, `airia devbox stop`, status/metadata via `gcloud ... describe --format=json`, time-zone fix via `gcloud ... add-metadata devbox-tz=`. In the cloud later the controller is a container runner with a service account — same protocol. |
| Stats | the runner on that machine | a sample every 60 s in the heartbeat (Node `os`: loadavg, CPU % from `os.cpus()` deltas, uptime; `fs.statfs` for disk; memory on macOS `sysctl kern.memorystatus_level`, on Linux `/proc/meminfo` MemAvailable; in a container its cgroup v2 limits, "A runner in a Docker container"); no SSH, one `sysctl` start per minute at most on the Mac |
| Reaching the server from the box | the power controller (the server in development, else This Mac's runner) | the box has no public address and its only ingress is SSH through Google IAP, so the controller holds one reverse tunnel per running box: `gcloud compute ssh <box> --tunnel-through-iap -- -N -R 127.0.0.1:<port>:127.0.0.1:<port>`, which makes the box's `127.0.0.1:<port>` the server's own port; the box's runner dials `ws://127.0.0.1:<port>/api/runner/ws` (since 2026-11-07, replacing the ngrok domain; the real domain after S8) |

Machine kinds: `laptop` (This Mac: no remote power; shows "asleep · last seen" when heartbeats stop), `container`
(Docker, always on while its host is), `vm` with provider `airia_devbox` (power through the controller). Defaults
never start a machine: auto-start switches are off until Ihor turns them on (v1 rule: starting costs money).

### The server as the power controller (MWC_LOCAL_POWER)

Since 2026-11-09 (Ihor's decision) the server drives the airia CLI itself when it runs on a computer that has `airia`
and `gcloud`: in development the API runs on his Mac as him, with his gcloud sign-in, so the devbox needs no runner on
This Mac to be started, stopped or linked. A runner controller is for a server without the tools (the hosted case
later). Never both:

| MWC_LOCAL_POWER | The server drives the devboxes |
|---|---|
| `auto` (default) | when `airia` and `gcloud` are both found and NODE_ENV is not `production` |
| `on` | always; the start fails with a `ConfigError` naming the missing tool |
| `off` | never: runner controllers do it, as before |

- **Finding the tools.** At start (`apps/server/src/platform/processes/power/local.ts`, where the connector is wired) the server
  looks for them the way a runner does (`localDevbox` of `@mwc/machine-airia-devbox`: the PATH's folders, then
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/google-cloud-sdk/bin`; no process started to look) and logs one line: the
  two paths it uses (`power: this server starts and stops the devboxes with the airia CLI and holds their tunnels with
  gcloud`), or why not. Whether gcloud is signed in shows on the first command (`needs_gcloud_login`).
- **Commands.** The server is then the controller of every devbox of every company it serves: `status`, `start`, `stop`
  and `set_timezone` run in-process through `AiriaDevboxDriver` (`processRun`, the tools by their full paths), with a
  runner controller's timeouts (200 s start and stop, 75 s the others), its answer read the same way (`<code>: <message>`
  → 502 `power_failed` with `driverCode`) and the same power events. No runner is ever sent `power.command`, and a
  box's saved `controller_machine_id` is not used. A start or a stop that finds the box already there runs no airia
  CLI (the driver's reading says `already`; a runner controller passes it as `metadata.already`), and its event says so:
  "Keep-on hours started (…): the box was already on", "Stopped by hand: the box was already off".
- **The tunnel.** The server holds each box's reverse tunnel itself with the same wanted set (a devbox not removed
  whose last power status is running, starting or not known), the same gcloud command (the driver's `tunnelCommand`)
  and the same supervisor (`@mwc/machines-core/tunnels`, shared with the runner: detached, process-group kill, 5 s to
  5 min backoff, reset after a minute up, `connecting`/`up`/`down` with the last stderr line). Its states go to the same
  memory `GET machines` reads (`tunnel`). Every runner controller gets an empty `tunnel.set`, so two tunnels never
  fight for the box's port. The graceful shutdown stops every tunnel.
- **The seam.** `modules/machines/service/power/control.ts`: the power service, the scheduler, the machines' views and
  the tunnels ask one `PowerControl` (`control/server.ts` this server, `control/runners.ts` the runner controllers
  through the hub), built once per process in `app.ts` (`machinesRuntime`).
- **On the page.** `GET machines/:id/power` answers `controller: {kind: 'server', machineId: null, name: 'This server
  (airia CLI)', online: true}` (a runner controller: `kind: 'machine'` with its id; none: null). The card says "Started
  and stopped by this server with your airia CLI" and "Linked through this server's SSH tunnel"; `GET /api/config` says
  `localPower: true`, and the devbox's install hint (the sheet and `mwc machine enroll-token`) says the box connects
  once the server holds its tunnel.
- **Not here.** Keeping This Mac awake (`caffeinate`) stays a runner's job, as do placements and the terminal.

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
- server → controller `tunnel.set {tunnels[{machineId, target, remotePort, localPort}]}` (the full set it should hold)
  → `tunnel.state {machineId, state connecting|up|down, error?}` per change (2026-11-07, "Installing a runner").
- `runner.hello.caps.terminal`; server → runner `terminal.open|input|resize|close`, runner → server
  `terminal.opened|output|exit` (2026-11-09, "Terminal").
- `runner.hello.build` (the SHA-256 of its bundle) and `runner.hello.caps.selfUpdate`; server → runner
  `runner.update {cmdId}` → `runner.update.result {cmdId, ok, build?, error?}` (2026-11-09, "Updating a runner").

## Code placement (per the keep-structure skill)

- `packages/machines-core`: the `MachinePowerDriver` port (`discover`, `status`, `start`, `stop`, `setTimezone`, and
  the optional pure `tunnelCommand`), a fake, and the reverse tunnels' supervisor (`@mwc/machines-core/tunnels`, spawn,
  kill and timers injected) shared by the runner and the server. `connectors/machine-airia-devbox`: implements it by
  spawning `airia` / `gcloud` (spawn injected; tests with recorded JSON and a fake spawn), and finds the two tools
  (`localDevbox`). Loaded by a runner controller, or by the server's `platform/processes/power/local.ts` (MWC_LOCAL_POWER).
- `apps/runner`: link, heartbeat + sampler, hold drivers (`hold/devbox.ts`, `hold/caffeinate.ts`), controller
  executing `power.command` through the connector and holding the devboxes' tunnels with the shared supervisor.
- The terminal: the runner's `terminal/` (the PTY loader, the shell and its environment, the batched output, the
  sessions); the server's `routes/terminal.ts` (the owner's ticket, the browser's socket), `service/terminal.ts` with
  `service/terminal/{tickets,relay}.ts`, and `service/runner/hub/terminals.ts` (the sessions of each runner connection).
- Updating a runner: the runner's `update/` (`build.ts` the build and the update target, `self-update.ts` the download,
  check and swap, `untar.ts` the PTY archive in memory, `updates.ts` the `runner.update` answer and the restart); the
  server's `routes/update.ts`, `service/runner/update.ts`, `rules/runner.ts` (the runner's facts, the commands by hand),
  `service/runner/download.ts`'s `servedBuild`, and the SSH reinstall in `platform/processes/power/reinstall.ts` with the connector's
  `updateCommand` (`connectors/machine-airia-devbox/src/ssh.ts` builds both gcloud ssh commands); the web's
  `features/machines/runner/`.
- The server's side of the power and the tunnels: `service/power/control.ts` (who drives the devboxes:
  `control/server.ts` this server, `control/runners.ts` the runner controllers), `service/power/tunnels.ts` (the wanted
  sets), `service/runner/hub/tunnels.ts` (the set last sent per connection and the reported states, the server's own too, in
  memory), `rules/tunnels.ts`.
- `apps/server/src/modules/machines/`: routes, service, repo, `rules/power.ts` (pure: keep-on window incl. overnight
  and TZ, hold-until, once-per-window auto-start where a manual Stop sticks, stop at the end only without live work),
  `rules/stats.ts` (overloaded = load1/cpus > 1.0 or CPU > 85 %; badge when overloaded now or > 50 % of 24 h; 5-min
  bucket means; up/down segments from sessions + power events; runtime = online time; agent runs 24 h = sum of run
  durations, "—" until S5). Scheduler + prune as jobs in `platform/jobs`. Logic ported from v1
  v1's power and load-stats services as design, rewritten with tests.
- API under `/api/companies/:companyId/`: `machines` (list/get/rename/remove), `machines/enrollment-tokens`,
  `machines/:id/power` (GET/PUT policy, POST start|stop|timezone — admins and owners; viewers read only),
  `machines/:id/events`, `machines/stats` (the board), `machines/:id/runner-update` (admins and owners); `POST
  /api/runner/enroll`, `GET /api/runner/ws`.
- Web: `/:slug/machines` (`pages/company/MachinesPage.tsx`, `features/machines/`): a card per machine — status,
  agents on it, the stats row, Start/Stop with the hourly cost (devbox), the Power form (keep-on hours, days, from/to,
  time zone, start when hours begin, stop when they end, hold minutes, keep This Mac awake, start on message / on work
  marked "from S5"), the box's own rules read-only with "Set the box's time zone to X", the last 10 log entries;
  **Add a machine** sheet: kind → a one-time enrollment token and the exact install command (Mac:
  `curl … install.sh | sh -s -- …`; devbox: `airia devbox ssh -- -R … '<install>'` for Ihor to run on This Mac;
  container: compose command), as "Installing a runner" below has them (the port of `apiUrl` in `GET /api/config`
  for the devbox's forward).
  Home `/:slug`: **Machines** widget under the limits widget, one row per machine as in his screenshot, refreshed
  every minute; new library pieces `components/data/Sparkline.tsx` (dashed threshold line) and `UpDownBar.tsx`.

## Installing a runner

Built in S4.5. A runner is one JavaScript file, `apps/runner/dist/runner.mjs` (`pnpm --filter @mwc/runner build`,
esbuild, Node 22 or newer, every dependency inside; `mwc check --full` builds it too), that runs the daemon (`run`) and
installs itself (`enroll`, `install`, `status`, `uninstall`; `node runner.mjs help`). The server hands it out:
`GET /api/runner/runner.mjs` (404 `runner_bundle_missing` until it is built; its SHA-256 in `x-mwc-runner-sha256`),
`GET /api/runner/runner.json` (the manifest beside it, its build time; the same 404 and header) and
`GET /api/runner/install.sh`, a POSIX script that checks for Node 22 and curl, downloads the bundle to a temporary
folder, checks its SHA-256, downloads `runner.json` beside it (checked the same way; a server without one is no error,
the runner then says no build time), downloads the terminal's PTY for the machine's system (`GET /api/runner/pty/<target>.tgz`,
checked the same way and unpacked beside the bundle with `tar`; "Terminal" below) and runs `node runner.mjs install`
with its own arguments. All are public: the enrollment token is the secret. Nothing is installed by the repository's
tooling; each install is a person's own step.

**1. A token.** An admin or owner makes one (good for one machine within the hour), and `mwc` prints the command for
each kind of machine with it:

```sh
pnpm mwc machine enroll-token [--company <slug>]
```

**2. The command, on the machine.**

| Machine | Command | What it installs |
|---|---|---|
| This Mac | `curl -fsSL <url>/api/runner/install.sh \| sh -s -- --server <url> --token mwc_et_…` | a launchd agent |
| Airia devbox | `airia devbox ssh -- -R 127.0.0.1:9954:127.0.0.1:<port> 'curl -fsSL http://127.0.0.1:9954/api/runner/install.sh \| sh -s -- --server http://127.0.0.1:<port> --via http://127.0.0.1:9954 --token mwc_et_…'`, run on This Mac (after This Mac's runner is installed, unless the server drives the airia CLI itself) (`<port>`: the port of the API's own address, `apiUrl` in `GET /api/config`, 9950 or a slot's; 9954: the install's own forward on the box, docs/ports.md; it starts a stopped box, which costs its hourly rate while up; the box connects once its controller holds its tunnel: the server, or This Mac's runner) | a systemd user unit |
| Docker container | `MWC_ENROLL_TOKEN=mwc_et_… MWC_RUNNER_NAME='Docker runner' MWC_RUNNER_CPUS=2 MWC_RUNNER_MEMORY=4g MWC_RUNNER_SLOTS=2 docker compose -p mwc-runner-docker-runner -f <repo>/deploy/compose.yml --profile runner up -d runner-local` (from any folder; below) | the `runner-local` service, in its own compose project |

**A runner in a Docker container** (2026-11-09, Ihor: "when we are enrolling CONTAINER, shouldn't we have some
guidelines for memory/CPU LIMITS for it???"). The add sheet's Docker container asks first for a **Name** (default
"Docker runner"), **CPUs** (0.5–16, default 2), **Memory** in GB (1–64, default 4) and **Runs at once** (1–8, default
2), with one line of guidance: leave room for Docker's other containers, since the Docker Desktop VM's own limit caps
these, and a Claude Code run needs about 1 CPU and 2 GB. **Create command** then makes the token and shows the command
with those values (`containerRunnerCommand` in `@mwc/shared/container-runner`, which `mwc machine enroll-token` prints
too, with the defaults):

```sh
MWC_ENROLL_TOKEN=mwc_et_… MWC_RUNNER_NAME='Docker runner' MWC_RUNNER_CPUS=2 MWC_RUNNER_MEMORY=4g MWC_RUNNER_SLOTS=2 \
  docker compose -p mwc-runner-docker-runner -f /path/to/repo/deploy/compose.yml --profile runner up -d runner-local
```

- **Limits.** `runner-local` in `deploy/compose.yml` has `cpus: ${MWC_RUNNER_CPUS:-2}`, `mem_limit` and
  `memswap_limit: ${MWC_RUNNER_MEMORY:-4g}` (no swap beyond it) and `pids_limit: 1024`; Docker enforces them. Runs at once
  is `MWC_RUNNER_SLOTS` (default 2), read once by the container's first-start enrollment into `runner.json`'s `slots`;
  changing it later means enrolling again (a new token and `down -v`, below).
- **Any folder.** `GET /api/config` has `composeFile`: the absolute path of the repository's `deploy/compose.yml`, from
  the server's own file (never its working folder), outside production; null in production, where the command keeps
  `-f deploy/compose.yml` and the sheet says to run it in the repository folder. The container reaches the server at
  `host.docker.internal:<the API's port>`; `MWC_SERVER_URL` is added only when that is not compose's default (9950).
- **One project per container.** `-p mwc-runner-<slug>` (the slug from the name: lowercase a-z, 0-9 and dashes, at most
  40 characters; the name in single quotes) gives each container its own compose project, so its own container and
  `runner-state` volume: a second runner with another name runs beside the first instead of replacing it. Two runners
  with names of the same slug share a project; the second start would only restart the first.
- **Removing one.** `docker compose -p mwc-runner-<slug> -f <repo>/deploy/compose.yml --profile runner down -v` stops and
  removes that container, its state volume (its runner key with it) and its work volume (its agents' home folders);
  remove the machine on the Machines page too.
- **The work volume** (S5.1d, 2026-11-09, Ihor: home folders "for a container, for sure from a persistent volume"). Each
  container runner has a named volume `runner-work` mounted at `/work` (one per compose project, like its state), so its
  agents' home folders survive restarts and image rebuilds. The image makes `/work` owned by the user `runner` (0755),
  which a new named volume copies when it is first mounted, so the runner can write it. Inside the container `/work` is
  the only folder the runner browses or makes ("The folder browser"), and agents' home folders default to
  `/work/<slug>`. A container added before S5.1d gets it with the same `up` command plus `--build` (no token): the
  rebuilt image has `/work`, and compose creates the volume.
- **Stats inside the container.** `os.cpus()` and `/proc/meminfo` describe the Docker VM, so a runner that knows it is
  in a container (Linux, with `MWC_RUNNER_IN_CONTAINER=1` as the image sets, or `/.dockerenv`) reads its cgroup v2 files
  (`apps/runner/src/stats/cgroup.ts`): CPUs from `cpu.max` (quota over period, to a tenth), CPU use from `cpu.stat`'s
  `usage_usec` between two samples against that limit, memory from `memory.current` less `memory.stat`'s
  `inactive_file` (as `docker stats` counts it) over `memory.max`. A part that is unlimited (`max`) or unreadable
  (cgroup v1) keeps the VM's numbers. The sample's `cpus` column is a whole number, so the card shows the limit rounded
  (at least 1); the memory limit itself is not on the card yet (it needs a new sample column).

**How the devbox reaches the server** (2026-11-07). The box has no public address: its only way in is SSH on port 22
through Google IAP, the way the airia CLI connects (`airia devbox ssh` is `gcloud compute ssh <box>
--tunnel-through-iap`). The dev server lives on This Mac and listens on `127.0.0.1:<port>` only, so the box reaches it
through a reverse SSH forward, and no public URL is needed:

- **The install.** The command above runs on This Mac. Its `-R` makes the box's `127.0.0.1:9954` (the install's own
  port) This Mac's API while the install runs, so `install.sh`, the bundle, the PTY and the enroll go through it
  (`--via http://127.0.0.1:9954`), while the box's runner keeps `--server http://127.0.0.1:<port>` in `runner.json`,
  the port only the standing tunnel below serves. `airia devbox ssh` starts the box first when it is stopped.
  **Why its own port** (2026-11-09): when the install forwarded the API's own port, the installed runner connected
  through the install's forward, and OpenSSH does not exit while a forwarded connection is open, so the install's
  session never ended; after an API restart that session (already exiting) still held the box's `127.0.0.1:<port>`
  but opened no new channels, so the runner's reconnects timed out and the standing tunnel (with
  `ExitOnForwardFailure`) could never bind the port. With its own port nothing holds the install's session open: it
  ends when `install.sh` ends, and the box connects once its controller holds its tunnel.
- **The standing tunnel.** When the server drives the airia CLI itself ("The server as the power controller") it holds
  the box's tunnel in its own process from the enrollment on, as below. Otherwise, after the enrollment the server
  tells the box's controller (This Mac's runner, the one that powers it, saved on the box when it is the company's only
  connected one) to hold the box's tunnel: `tunnel.set` (docs/runner-protocol.md, "Hold and power"). The holder starts
  one long-lived
  `gcloud compute ssh <box> --project airia-devbox --zone <zone> --tunnel-through-iap --quiet
  --strict-host-key-checking=no -- -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3
  -o BatchMode=yes -R 127.0.0.1:<port>:127.0.0.1:<port>` per box, with gcloud's full path. Plain `gcloud compute ssh`
  never starts a stopped box (`airia devbox ssh` and `ssh devbox` would), so the tunnel is wanted only while the box's
  last known power status is running, starting or not known yet; a stopped or missing box's tunnel is stopped. It runs
  in its own process group (gcloud starts ssh and an IAP helper) and is stopped as one: SIGTERM, then SIGKILL after
  5 s. One that ends is started again after 5 s, doubling up to 5 minutes, back to 5 s after one that stayed up a
  minute (the Mac bills each process start). The card of the box says "Linked through this server's SSH tunnel" (or
  This Mac's), or "Tunnel reconnecting" with ssh's "remote port forwarding failed" line, else the last line gcloud
  printed. Since 2026-11-09 (Ihor's approval) a forward failure, which means a stale session of an earlier tunnel still
  holds the box's port (a killed tunnel's end goes unnoticed by the box's sshd behind IAP, sometimes for over an hour),
  makes the holder run the driver's `clearPortCommand` once (`gcloud compute ssh <box> … --command 'sudo -n fuser -k
  -TERM -n tcp <port> || fuser -k -TERM -n tcp <port>; true'`, ending only what listens on that port, and only after
  a failed try, so never one of its own live tunnels) and try again after 2 s; at most once in 5 minutes per tunnel,
  after which the backoff applies (`power: cleared a stale holder of the box's port` in the log). Without the server's own driver, This Mac's
  runner must be installed (and connected) first, since it keeps the box linked.
- **When the Mac sleeps.** The dev server lives on the Mac anyway, so nothing is lost: while the Mac sleeps there is
  no server to reach; the box's runs keep going (their journals are on the box), its runner reconnects with its usual
  backoff, and the tunnel comes back with the Mac.

`MWC_PUBLIC_URL` stays the address other machines reach the API at (`GET /api/config` answers it as `publicUrl`, null
while it is unset); the devbox's command does not use it. Leave it unset in development (or set it to the API's own
`http://localhost:<port>`): the devbox's `<port>` is the port of `apiUrl`, which is `MWC_PUBLIC_URL` when it is set. The
box needs Node 22 on the PATH of a non-interactive SSH command; a Node from nvm needs `. ~/.nvm/nvm.sh &&` in front of
`curl`.

**What `install` does.** `install --server <url> [--via <url>] --token <mwc_et_…> [--name <name>] [--slots <n>] [--force]`
(`--via`, in install.sh too: the address this install reaches the server at, for the downloads and the enroll, when it
is not `--server`, the address the runner keeps; without it everything uses `--server`):

1. Refuses first, before the token is used: a system other than macOS or Linux, a container, a runner run from its
   sources instead of `runner.mjs`, a machine already enrolled (`--force` enrolls it again as a new machine).
2. Enrolls (`POST /api/runner/enroll`): the kind (macOS `laptop`; `/.dockerenv` or `MWC_RUNNER_IN_CONTAINER=1`
   `container`; else `vm`), the system, architecture, host name, Unix user, the runner's version, Claude Code's
   version (one `claude --version`, only when `claude` is found: on the PATH or in the usual folders of
   docs/harness.md, "Where the runner finds the CLIs") and the provider: a machine with
   `/usr/local/bin/devbox-keepalive` whose GCE metadata server names its instance, zone and project (1 s at most) is
   `airia_devbox`. The name is `--name`, else `Airia devbox`, else the short host name. 2 slots unless `--slots`.
   The id and the runner key go to `~/.config/mwc/runner.json` (0600 in a 0700 folder).
3. Copies itself to `~/.local/share/mwc-runner/runner.mjs`, with the PTY install.sh unpacked beside it
   (`node_modules/@lydell/node-pty-<target>/`, replacing the one there; a reinstall from the installed copy keeps its
   own; without one it warns that the machine has no terminal), and starts it as a service with the Node that installed it
   and a short PATH (Node's folder, the folders of `claude`, `git`, `gh`, `docker`, `airia` and `gcloud` found on the
   installer's PATH, the usual install folders that exist here (`~/.local/bin`, `~/.claude/local`, `~/.npm-global/bin`,
   `~/.bun/bin`, `~/.volta/bin`, `/opt/homebrew/bin`, the newest nvm Node's `bin` …, so an install over a
   non-interactive SSH command gets what a Terminal's PATH has), the system's):
   - **macOS:** `~/Library/LaunchAgents/com.mwc.runner.plist` (RunAtLoad, KeepAlive while it fails, ThrottleInterval
     10, its log `~/.local/state/mwc-runner/runner.log`), loaded with `launchctl bootstrap gui/<uid>` (from a Terminal
     of the desktop session). launchd cannot leave a service stopped after chosen exit codes, so under launchd the
     runner exits 0 after a refused key (77), a runner too old (76) or a broken configuration (78) and stays stopped
     until it is installed again.
   - **Linux:** `~/.config/systemd/user/mwc-runner.service` (Restart=always after 10 s, `RestartPreventExitStatus=76
     77 78`, 90 s to stop), `loginctl enable-linger` (or `sudo -n`, else a warning: the runner then stops at logout),
     `systemctl --user daemon-reload` and `enable --now`; its log is `journalctl --user -u mwc-runner.service`.

Run again without `--token`, `install` keeps the enrollment and reinstalls the service on the new bundle (a restart).
That is how a runner is updated by hand (since 2026-11-09 the card's **Update runner** does it: "Updating a runner"
below): the machine's install command without `--token`
(`curl -fsSL <url>/api/runner/install.sh | sh -s -- --server <url>`, the devbox's through `airia devbox ssh` as above,
with `--via http://127.0.0.1:9954` and no `--token`)
downloads the new bundle and PTY and reinstalls them on the enrollment it has; `--server` alone must name the server the
machine is enrolled on (another is refused with 64). A container is updated by rebuilding its image (the same `up` with
`--build`, no token: its enrollment is in the state volume).
`node ~/.local/share/mwc-runner/runner.mjs status` shows the enrollment, the service file and what the runner's health
endpoint (127.0.0.1:9953) says, and exits 0 only when it is connected; `uninstall` removes the service and the
installed copy and keeps `runner.json` (`--purge` removes it and the state folder); the machine stays on the server until
it is removed on the Machines page.

**The container** (`deploy/Dockerfile.runner`): Node 24 slim, git, tini as PID 1, the bundle, the user `runner`, its
state and `runner.json` in the volume `/var/lib/mwc-runner`, its agents' home folders in the volume `/work`. Started without a `runner.json` and with
`MWC_ENROLL_TOKEN` and `MWC_SERVER_URL`, the runner enrolls itself (kind `container`, named by `MWC_RUNNER_NAME`,
`runner-local` in compose), then runs; later starts reuse the enrollment. The `runner-local` service is behind the
compose profile `runner` (plain `docker compose up` still starts the dev Postgres only), reaches the dev API at
`http://host.docker.internal:9950` (`MWC_SERVER_URL` overrides it), has a health check on 9953 and 90 s to stop.
`docker compose -f deploy/compose.yml down` (what `mwc dev --down` runs) may stop it too; the same `up` command starts
it again without a token. The image has no Claude Code yet (S5). Its PTY is unpacked beside the bundle at build time
(`/opt/mwc-runner/node_modules/`), so its terminal is `/bin/bash` as the user `runner` in `/home/runner`.

## Terminal

Built 2026-11-09 (Ihor: "add CONNECT via SSH so i can jump into it and have a command line to control it"; he chose a
terminal in the page carried by the runner). An owner opens a real shell on any online machine (This Mac, the Airia
devbox, a runner container) from the Machines page. It is carried by the machine's runner over the WebSocket it already
holds to the server (`terminal.*` frames, docs/runner-protocol.md "Terminal"): no SSH keys, no new port, and it never
wakes a box (a stopped box or a sleeping Mac has no connected runner, so it is offline).

- **Owners only.** `POST /api/companies/{companyId}/machines/{machineId}/terminal-tickets` (owner role; admins and below
  get 403, another company's machine the module's 404) answers 201 `{ticket, expiresAt, wsPath}`, or 409
  `machine_offline` (no connected runner) or `terminal_unavailable` (its runner announced `caps.terminal: false`). The
  ticket is random, works once within 60 s, is bound to the user, the company and the machine, and the server keeps
  only its SHA-256, in memory. Each terminal opened is an `audit_log` row: entity `machine`, action `terminal_open`, field
  `terminalSession` (the session id), the owner as the actor, the socket's request id. Nothing is recorded of what is
  typed or printed.
- **It runs as the runner's user**, with that user's rights on that machine: Ihor's own user on This Mac (the launchd
  agent) and on the devbox (the systemd user unit, his GitHub login and sudo there), `runner` in a container. The shell is
  the user's login shell (`$SHELL` when it exists, else `/bin/bash`, else `/bin/sh`) started with `-l`, in the home
  folder, with the runner's environment less every `MWC_*` variable (its configuration, a container's enrollment token),
  `TERM=xterm-256color`, and `LANG` (`en_US.UTF-8` on macOS, `C.UTF-8` on Linux) only when no locale is set.
- **What keeps it open.** The browser's socket (pinged every 20 s) and the runner's link. An open terminal counts as
  live work for the runner's own hold, as a live run does (`hold.state` source `live_runs`): the devbox's keepalive is
  refreshed and This Mac keeps its `caffeinate` while a terminal is open, so a box does not stop under it.
- **What closes it.** Closing the browser's socket (`terminal.close`: SIGHUP, then SIGKILL 5 s later); the shell
  exiting (`exit` with its code, or the signal); the runner's link dropping (the runner ends its shells, and the server
  ends the browser's socket with `error: 'machine_disconnected'`); the runner stopping (`runner_stopping`); 60 minutes
  after the last input (a notice line, then `idle_timeout`). A machine has at most 4 terminals at once
  (`too_many_sessions`). Output is batched (about 16 ms or 32 KB) and the PTY is paused while the link's send buffer is
  over 1 MB (resumed at 256 KB).
- **The PTY.** node-pty's prebuilt build in four platform packages, `@lydell/node-pty-<platform>-<arch>` 1.2.0-beta.15
  (darwin-arm64, darwin-x64, linux-x64, linux-arm64), dependencies of `@mwc/runner`, so pnpm installs all four on every
  machine and no machine compiles anything. It is native, so it is not in `runner.mjs`: `pnpm --filter @mwc/runner build`
  also packs each as `apps/runner/dist/pty/<target>.tgz` (laid out as `node_modules/@lydell/node-pty-<target>/`, modes
  kept), the server serves it with its SHA-256 (404 `runner_pty_missing` otherwise), `install.sh` checks and unpacks it,
  and `install` copies it beside the installed bundle. The daemon loads it when it starts (`createRequire` from its own
  file: `node_modules/` beside `runner.mjs`, or the package's own from the sources); when it cannot, it logs `no terminal
  on this machine` with the reason, announces `caps.terminal: false` and answers every `terminal.open` with
  `terminal_unavailable`. A runner installed before this gets its terminal by being updated (the card's **Update
  runner**, "Updating a runner" below; a container by rebuilding its image); until then the card's Terminal button is
  disabled with "Update the runner to use the terminal".

**A chat's terminal** (S5.1b, docs/harness.md "How a turn runs") uses the same ticket store and socket: an owner's
`POST /api/companies/{companyId}/chats/{chatId}/terminal-tickets` resolves the chat's harness, folder and credential, and
the socket's `terminal.open` then carries `harness`, so the runner opens the harness's TUI on the chat's conversation
instead of a login shell. A Codex login it rewrote comes back in `terminal.exit` and is sealed again, never sent to the
browser.

**The browser's socket** (the contract the web's xterm.js panel builds on):

1. Get a ticket (above). Open `new WebSocket(<the API's ws origin> + wsPath + '?ticket=' + encodeURIComponent(ticket) +
   '&cols=' + cols + '&rows=' + rows)` from the web app's page, within 60 s. The server takes only the web origin
   (`MWC_WEB_ORIGIN`, the browser's `Origin` header). In development the web on 9951 proxies `/api` to the API; that
   proxy must also forward WebSockets (`ws: true`), or the page opens the socket on the API's own address (`apiUrl` in
   `GET /api/config`, with `ws:` for `http:`); the `Origin` is the page's either way.
2. Refused before the upgrade (a browser sees only a close with 1006): not an upgrade (426 `upgrade_required`), another
   origin or none (403 `origin_not_allowed`), a missing or bad size (400 `invalid_request`; cols 2–500, rows 1–300), and
   an unknown, used or expired ticket (401 `invalid_ticket`). Origin and size are checked before the ticket is used, so
   a refused size keeps it. A socket that fails at once is best shown as "the link expired, open it again".
3. Browser to server, JSON text: `{type: 'input', data}` (UTF-8 text as xterm.js's `onData` gives it; the server sends it
   on as base64 frames of at most 64 KB) and `{type: 'resize', cols, rows}`. A message is at most 256 KB. One that is
   not one of these is answered with `{type: 'error', code: 'invalid_message', message}` and the socket stays open.
4. Server to browser, JSON text: `{type: 'opened', shell}` once the shell started; `{type: 'output', data}`, the raw
   bytes in base64 (decode to a `Uint8Array` and `term.write(bytes)`, so characters split across messages stay whole);
   `{type: 'exit', code, signal?, error?}` (`code` the shell's exit code, or null with the `signal`; `error` when the
   runner or the server ended it: `idle_timeout`, `machine_disconnected`, `runner_stopping`, `too_many_sessions`,
   `terminal_unavailable`, `spawn_failed: …`), then the close (1000, "The terminal ended"); or
   `{type: 'error', code: 'machine_offline' | 'terminal_unavailable', message}` when the machine changed since the
   ticket, then the close (1000, "No terminal").
5. Closing the socket ends the terminal. Types and schemas: `TerminalToServer`, `TerminalToBrowser`, `TERMINAL_WS_PATH`
   and the limits in `@mwc/shared/runner-protocol`.

## Runner versions

Added 2026-11-09 (Ihor: "what is the version of the runner running on an agent machine, and what is defined by the
system as the last one"). A runner's version is its package's semver plus its build time:

- **The semver** is `apps/runner/package.json`'s `version`, bumped with each stage's release tag (0.5.0 from S4 on).
- **The build time.** `pnpm --filter @mwc/runner build` stamps the bundle with its version only (esbuild `define`) and
  writes `dist/runner.json` `{ version, builtAt, sha256 }` beside `runner.mjs` (`builtAt` in UTC ISO 8601; the PTY
  archives keep their own hashes). The bundle is reproducible: it carries no build time, so the same sources build the
  same bytes, and a runner built elsewhere from the same commit (the Docker image builds its own) has the hash the
  server serves and counts as current (2026-11-09: a stamped build time once made every rebuilt container "out of date"
  forever). The build time lives only in `runner.json`, which goes wherever the bundle goes: the server serves it,
  `install.sh` downloads it, `install` copies it beside the installed `runner.mjs`, the self-update writes it with the
  bundle, and the image has it at `/opt/mwc-runner/runner.json`. The runner reads `builtAt` from the `runner.json`
  beside the file it runs, once at start (null when missing or garbled). Run from its sources, the runner says its
  package's version and `builtAt: null`.
- **The hello.** `runner.hello` carries `version` (the stamped one) and `builtAt` (from `runner.json`; null from the
  sources or without one; a runner older
  than this leaves it out, which parses as null).
- **The server.** It reads `dist/runner.json` beside the bundle it hands out (again only when the file's time or size
  changes; null while the bundle or the manifest is missing or the manifest does not parse). `GET machines` answers
  `latestRunner: { version, builtAt, build } | null` beside the machines, and each machine's `runner` carries `version`
  (its connected runner's, else the one on record from its last hello) and `builtAt` (null offline). `current` still
  compares the bundle hash only; versions are never compared.
- **On the page.** The card's facts line reads "Runner 0.5.0 · built 9 Nov 16:40" (local time; "build unknown" without
  a build time); an out-of-date runner's badge reads "Runner out of date · latest 0.5.0 · built 9 Nov 17:05" next to
  Update runner; the Machines page header shows a quiet "Latest runner 0.5.0 · built …".

## Updating a runner

Built 2026-11-09 (Ihor: one click, never an install command again to update a runner). Before versioned runners every
bundle said version 0.1.0, and two builds of one version still say the same version, so the build tells an old runner
from a new one:

- **Which build a runner runs.** At start the runner hashes the `runner.mjs` it was started from, once (SHA-256, the
  same hash `install.sh` checks), and says it in `runner.hello` as `build` (null from its sources), with
  `caps.selfUpdate`: true only for the installed copy (`~/.local/share/mwc-runner/runner.mjs`) run by launchd or systemd,
  whose service files say which in `MWC_RUNNER_SERVICE` (the systemd unit says it since this change; launchd's plist
  did already); false in a container and from the sources. The server knows the build it hands out (the bundle's SHA-256,
  hashed again only when the file's time or size changes) and `GET machines` answers each machine's
  `runner: {version, builtAt, build, current, terminal, selfUpdate}` from what its connected runner said (memory, no migration):
  `current` is true or false when both builds are known, null otherwise (an offline machine, a runner older than
  `build`, an unbuilt bundle). The home board's stats rows do not carry it.
- **On the card.** For admins and owners, while the machine is online and its runner is out of date (`current` false)
  or has no terminal, the header line shows a small **Runner out of date** badge and the action row an **Update runner**
  button: a spinner while the server works, then what it did; the card loads again 15 s later, when the runner is back
  on its new build. A refusal shows its message, and for `update_unsupported` the command in a box with Copy.
- **The API.** `POST /api/companies/{companyId}/machines/{machineId}/runner-update` (admins and owners; another
  company's machine is the module's 404) picks the first path that applies and answers 202 `{path, build}`:
  1. **`self_update`**: a connected runner with `caps.selfUpdate` is sent `runner.update` and its answer awaited
     (3 minutes at most). The runner refuses with `busy` while runs are live (S5; it never ends one for an update),
     otherwise downloads `GET /api/runner/runner.mjs` and its system's `GET /api/runner/pty/<target>.tgz` from the server
     it is linked to (the devbox through its standing tunnel), checks each against its `x-mwc-runner-sha256` header,
     and only then puts them in place beside the installed copy: the bundle to a temporary file, the PTY unpacked in
     memory into a staging folder, the old `node_modules/` moved aside, the new one moved in, the temporary bundle
     renamed over `runner.mjs`; any failure puts the old copy back. A server without a PTY for its system leaves the
     one there. Its open terminals end with a notice line (`runner_updating`), it answers `runner.update.result` with
     the new build, and 250 ms later stops and exits **75** (EX_TEMPFAIL): systemd's `Restart=always` restarts any exit
     but 76–78 (after its 10 s), and launchd's `KeepAlive {SuccessfulExit: false}` restarts any exit but 0 (after its
     ThrottleInterval, 10 s). It then reconnects as usual and says its new build.
  2. **`ssh_reinstall`**: an Airia devbox whose runner cannot update itself (no `selfUpdate`, like a box installed
     before this, or one that answers `unsupported`), when this server drives the airia CLI itself (MWC_LOCAL_POWER),
     and only while the box runs (its connected runner says so; otherwise one `gcloud … describe`; a stopped box is never
     started: 409 `machine_offline`). The server runs, as Ihor approved, `gcloud compute ssh <instance> --project
     <project> --zone <zone> --tunnel-through-iap --quiet -- -o ExitOnForwardFailure=yes -R
     127.0.0.1:9954:127.0.0.1:<apiPort> 'curl -fsSL http://127.0.0.1:9954/api/runner/install.sh | sh -s -- --server
     http://127.0.0.1:<apiPort> --via http://127.0.0.1:9954'` (the connector's `updateCommand`, gcloud by its full path,
     its own process group, 3 minutes at most, its last stderr line as the error): the install keeps the enrollment,
     writes the systemd unit again and restarts the runner on the new bundle, which then updates itself next time.
  3. Otherwise 409 `update_unsupported` with `command`, the one to run by hand (no token in it): a container's
     `docker compose -p mwc-runner-<slug of its name> -f <the compose file's absolute path> --profile runner up -d --build
     runner-local` (its own project, as the add sheet started it; the relative path in production, run in the repository
     folder), which keeps its enrollment and volumes; This
     Mac's (or any other machine's) `curl -fsSL <apiUrl>/api/runner/install.sh | sh -s -- --server <apiUrl>` there;
     the devbox's `airia devbox ssh` install without a token from This Mac when the server has no airia CLI of its own.
  Refusals: 409 `machine_offline` (no connected runner and no reinstall possible), 409 `runner_busy`, 502
  `update_failed` (the runner's or the reinstall's words; the runner goes on as it was). Each update carried out is an
  `audit_log` row: entity `machine`, action `runner_update`, fields `runnerUpdate` (the path) and `runnerBuild` (the new
  build, when said), the person as the actor.
- **Trust.** It trusts the server over the runner's authenticated link and checks SHA-256 only; the signed self-update
  (Ed25519, release channels) stays in S8. Nothing updates without the click, and containers are rebuilt, never updated
  in place.

**A runner installed before this** says no build and no `selfUpdate`: `current` is null, so its card shows **Runner
out of date** and **Update runner** only while it has no terminal (the box's runner, installed before the terminal).
With the server driving the airia CLI, the box's button reinstalls it over SSH (`ssh_reinstall`); from then on it says
its build and updates itself over its link. The server hands out the bundle in `apps/runner/dist/` as it was last built
(`pnpm --filter @mwc/runner build`), so build it after pulling a runner change, or the update installs the old one.

## Placements

Built in S4.7 (migration `0010_agent_placements`). An agent's placement is where its runs start (docs/subscriptions.md,
"Where agents live"): a machine of the company and a mode, `host` (in its home folder on the machine, as the machine's
user) or `container` (a fresh locked-down container per run; taken on any machine for now). `agent_placements` holds the
home folder (absolute, 1–500 characters: the run's working folder, so its CLAUDE.md, skills and memory load), an
optional `config_dir` (`CLAUDE_CONFIG_DIR`) and `worktree_root`, and `permission_policy` `ask|bypass` (default `ask`),
with at most one default placement per agent (`is_default`, a partial unique index). No run uses it before S5.

The machines module owns the table: its rows live and die with a machine (a machine's removal deletes its placements in
the removal's transaction, audited as the remover's) and are counted per machine. The org module reads them through the
machines module's service (`placementsOf`) for its lists; the machines module reads only an agent's id and status. An
archived agent keeps its placement and is left out of the counts.

- `GET /api/companies/:companyId/agents/:agentId/placement` (viewer and above) → `{ placement }`, the default placement
  with `machineName` and `machineStatus`, or null.
- `PUT` the same (admin and above) `{ machineId, mode, home, configDir?, worktreeRoot?, permissionPolicy }` → the
  placement, created or changed in place under the company's lock; a machine not in the company or removed is a 422
  `machine_not_found`. `DELETE` (admin and above) → 204, or 404 `placement_not_found`. Every change is audited per field
  (`agent_placement`).
- `GET agents`, an agent and the chart's agent nodes carry `placement: { machineId, machineName, mode } | null`;
  `GET machines`, a machine and `GET machines/stats` rows carry `agentCount` (agents not archived whose default
  placement is on it).
- Web: **Where it runs** at the end of the agent form's How it works (a machine with its status, the mode, the home
  folder with **Browse…**, the permissions; saved with the agent, read-only below admin), "Runs on <machine> · <mode>"
  in the agent's facts, and a Machine column in the agents table.

### The folder browser

Built in S5.1d (2026-11-09, Ihor: when hiring an agent he picks the machine and its home folder "from the FOLDER selector
considering a type of the device; for a container, for sure from a persistent volume"). The server reads a machine's
folders through its runner (`fs.list`, `fs.mkdir`: docs/runner-protocol.md, "Folders"); folders only, never a file's
contents, and nothing is deleted or renamed.

- `GET /api/companies/:companyId/machines/:machineId/folders?path=` (admin and above) → `{ path, parent, entries[{name,
  git, claudeMd}], truncated, home, root, agentsRoot }`: the folder (the runner's default start without `path`: its
  user's home, or `/work` in a container), its folders sorted without dot-folders (at most 500), the runner user's home,
  the only allowed root (`/work` in a container, else null) and where agents' home folders go by default (`root`, else
  `<home>/agents`).
- `POST` the same `{ path }` (admin and above) → 201 `{ path }`: one new folder (0755) whose parent exists, audited on
  the machine (`folder_create`, field `folder`).
- Refusals: 400 `invalid_request` (a path that is neither absolute nor `~/…`), 403 below admin, 404 another company's or
  an unknown machine, 409 `machine_offline` (no connected runner) and `runner_outdated` (a runner without
  `caps.folders`), 422 for the runner's refusals in plain words (`folder_not_found`, `not_a_directory`,
  `permission_denied`, `outside_volume`, `folder_exists`, `invalid_path`, `folder_failed`), 504 `runner_timeout` after
  10 s.
- Web (`features/placements/`): **Browse…** beside the home folder opens a sheet on the chosen machine: breadcrumbs (from
  `/`, or from `/work` in a container), the folders with their git and CLAUDE.md marks, **Up**, **New folder** (a name,
  then it is made and opened) and **Choose this folder**. It starts at the field's folder, else its parent, else the
  default start. While the field is empty it suggests the agent's default home (`<home>/agents/<slug>` from the runner,
  or `/work/<slug>` for a container) with **Use suggested**. `runner_outdated` reads "Update this machine's runner on the
  Machines page to browse its folders".
- Runners need an update for it (an older one is refused as `runner_outdated`); a Docker runner needs the rebuild that
  brings its work volume ("A runner in a Docker container").

## Logos

A machine can have a logo, as a company does (migration `0011_machine_logos`): `machine_logos` holds one image per
machine (primary key `(company_id, machine_id)`, a composite foreign key to the machine with `ON DELETE CASCADE`; a
removed machine keeps its row, as it keeps its history), with the company logo's limits and checks: a PNG, JPEG or WebP
image of at most 1 MB, its type told from its first bytes, its SHA-256 the ETag and, cut to 16 characters, its version.
`GET /api/companies/:companyId/machines/:machineId/logo` (viewer and above; 404 `logo_not_found` without one) answers
as the company logo does (cached for good with `?v=<version>`, 304 for its ETag); `PUT` (a multipart form with `file`)
and `DELETE` are for admins and owners, each change audited as the machine's `logo` field. Another company's machine,
an unknown or a removed one is a 404 `machine_not_found`. `GET machines`, a machine and `GET machines/stats` rows carry
`logo: { version } | null`. Web: the machine's tile on its card and on the home board shows the logo, else its kind
icon (`features/machines/MachineLogo.tsx`); for admins and owners a click on the card's tile opens the company logo's
picker in a sheet (pick, crop, upload, Remove).

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
- Live, each step with Ihor's OK: runner on This Mac as a launchd service; compose `runner-local`; runner on the
  devbox installed once with `airia devbox ssh -- -R …` from This Mac, then linked through This Mac's tunnel (the box
  costs its hourly rate while up); all three online on the Machines page and on the home widget with live numbers; server restart → all
  reconnect and samples continue; Start / Stop the box from the page; keep-on window → keepalive file extended and the
  "held" log entry; This Mac's hold visible in `pmset -g assertions`; hold ends → box stops by its own policy.

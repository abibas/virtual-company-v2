/**
 * The Docker host of the container runners' rebuild tests, faked: `docker inspect` answers recorded the way Docker 29 and
 * compose 5 print them (labels, limits, the environment with a used enrollment token), `docker ps` lists a project's
 * runner containers, and `docker compose … up` prints its build lines and ends when the test says. Every call is kept.
 */

import type { LocalDocker } from '../../../src/platform/processes/docker/local.ts';
import type { DockerResult } from '../../../src/platform/processes/docker/run.ts';

/** A container runner as `docker inspect` describes it. */
export interface RecordedContainer {
  readonly id: string;
  readonly project: string;
  readonly files: string;
  readonly folder?: string;
  readonly service?: string;
  readonly nanoCpus?: number;
  readonly memory?: number;
  readonly env?: readonly string[];
  /** Docker's state (`running` unless told), its health (`healthy` while running) and its stop timeout (90 s). */
  readonly state?: string;
  readonly health?: string | null;
  readonly stopTimeout?: number | null;
}

/** The environment the add sheet's command gives a container runner (its token used long ago). */
export const RUNNER_ENV = [
  'MWC_ENROLL_TOKEN=mwc_et_usedlongago',
  'MWC_RUNNER_NAME=Docker runner',
  'MWC_RUNNER_SLOTS=2',
  'MWC_SERVER_URL=http://host.docker.internal:9950',
  'PATH=/home/runner/.local/bin:/usr/local/bin:/usr/bin:/bin',
  'NODE_ENV=production',
  'MWC_RUNNER_IN_CONTAINER=1',
];

/** Its `State` as Docker 29 prints it: a running one with its health check's state, a stopped one with its exit. */
function stateOf(c: RecordedContainer) {
  const status = c.state ?? 'running';
  if (status !== 'running') return { Status: status, Running: false, ExitCode: 0 };
  const health = c.health === undefined ? 'healthy' : c.health;
  return { Status: status, Running: true, ...(health === null ? {} : { Health: { Status: health } }) };
}

/** `docker inspect --type container <id>`'s answer for one container runner. */
export function inspectJson(c: RecordedContainer): string {
  const folder = c.folder ?? c.files.slice(0, c.files.lastIndexOf('/'));
  return JSON.stringify([
    {
      Id: `${c.id}${'0'.repeat(64 - c.id.length)}`,
      Created: '2026-11-10T12:52:37.123456789Z',
      Name: `/${c.project}-runner-local-1`,
      State: stateOf(c),
      Config: {
        Hostname: c.id.slice(0, 12),
        ...(c.stopTimeout === null ? {} : { StopTimeout: c.stopTimeout ?? 90 }),
        Env: c.env ?? RUNNER_ENV,
        Labels: {
          'com.docker.compose.config-hash': 'b9432ec8b4604f05',
          'com.docker.compose.container-number': '1',
          'com.docker.compose.oneoff': 'False',
          'com.docker.compose.project': c.project,
          'com.docker.compose.project.config_files': c.files,
          'com.docker.compose.project.working_dir': folder,
          'com.docker.compose.service': c.service ?? 'runner-local',
          'com.docker.compose.version': '5.6.1',
        },
      },
      HostConfig: { NanoCpus: c.nanoCpus ?? 2_000_000_000, Memory: c.memory ?? 4_294_967_296 },
    },
  ]);
}

/** One `docker` call the fake received. */
export interface DockerCall {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs: number;
}

const ok = (stdout = ''): DockerResult => ({ ok: true, stdout, lines: [] });
const failed = (error: string): DockerResult => ({ ok: false, stdout: '', lines: [error], error });

/** How a fake command ends: held until `finish` or not, and with what. */
interface Ending<R> {
  hold: boolean;
  result: R;
}

/** The fake host's state: its containers by short id, whether its daemon is down, how the next commands end. */
interface Host {
  readonly calls: DockerCall[];
  readonly containers: Map<string, RecordedContainer>;
  daemonDown: boolean;
  release: ((result: DockerResult) => void) | undefined;
  compose: Ending<DockerResult | 'reject'> & { lines: readonly string[] };
  power: Ending<DockerResult>;
}

/** A result held until `finish`: the held one when it ends well, else the failure `finish` gives. */
const held = (host: Host, result: DockerResult) =>
  new Promise<DockerResult>((resolve) => {
    host.release = (end) => resolve(end.ok ? result : end);
  });

/** `docker inspect` of one container, or `docker ps` of a project's runner containers; undefined for another. */
function read(host: Host, args: readonly string[]): DockerResult | undefined {
  if (args[0] === 'inspect') {
    const container = host.containers.get(args.at(-1) ?? '');
    return container === undefined
      ? failed(`Error: No such container: ${args.at(-1)}`)
      : ok(inspectJson(container));
  }
  if (args[0] !== 'ps') return undefined;
  const project = args.find((arg) => arg.startsWith('label=com.docker.compose.project='))?.split('=')[2];
  const ids = [...host.containers].filter(([, c]) => c.project === project).map(([id]) => id);
  return ok(ids.length === 0 ? '' : `${ids.join('\n')}\n`);
}

/** `docker start <id>` or `docker stop -t <s> <id>`: the container's new state once it ended well. */
async function powerCommand(host: Host, args: readonly string[]): Promise<DockerResult> {
  const id = args.at(-1) ?? '';
  const ended = host.power.hold ? await held(host, host.power.result) : host.power.result;
  const container = host.containers.get(id);
  if (!ended.ok) return ended;
  if (container === undefined) return failed(`Error response from daemon: No such container: ${id}`);
  host.containers.set(id, { ...container, state: args[0] === 'start' ? 'running' : 'exited' });
  return ok(`${id}\n`);
}

/** `docker compose … up`: its lines, then its end (held until `finish` when told). */
async function composeCommand(host: Host, onLine: ((line: string) => void) | undefined) {
  const { compose } = host;
  for (const line of compose.lines) onLine?.(line);
  if (compose.result === 'reject') throw new Error('spawn failed oddly');
  if (!compose.hold) return compose.result;
  return new Promise<DockerResult>((resolve) => {
    host.release = resolve;
  });
}

const fresh = (): Pick<Host, 'compose' | 'power'> => ({
  compose: { lines: [], hold: false, result: ok() },
  power: { hold: false, result: ok() },
});

/**
 * The fake Docker host: its containers by id, the projects' runner containers, how compose ends, and `docker start` /
 * `docker stop`, which change the container's state when they end well.
 */
export function fakeDocker() {
  const host: Host = { calls: [], containers: new Map(), daemonDown: false, release: undefined, ...fresh() };
  const { calls, containers } = host;
  const docker: LocalDocker = {
    path: '/usr/local/bin/docker',
    async run(args, options) {
      calls.push({ args, env: options.env, timeoutMs: options.timeoutMs });
      if (host.daemonDown)
        return failed('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
      const answer = read(host, args);
      if (answer !== undefined) return answer;
      if (args[0] === 'start' || args[0] === 'stop') return powerCommand(host, args);
      return composeCommand(host, options.onLine);
    },
  };
  return {
    docker,
    calls,
    /** The compose calls (the rebuilds). */
    rebuilds: () => calls.filter((call) => call.args[0] === 'compose'),
    /** A container Docker knows, under its short id. */
    add(container: RecordedContainer) {
      containers.set(container.id.slice(0, 12), container);
    },
    /** The container's state now (`running`, `exited`), undefined when Docker has none of this id. */
    stateOf: (id: string) => {
      const container = containers.get(id.slice(0, 12));
      return container === undefined ? undefined : (container.state ?? 'running');
    },
    /** The `docker start` and `docker stop` calls. */
    powers: () => calls.filter((call) => call.args[0] === 'start' || call.args[0] === 'stop'),
    /** How the next `docker start` and `docker stop` go: held until `finish`, and how they end. */
    powerWill(next: Partial<Host['power']>) {
      host.power = { ...host.power, ...next };
    },
    /** Every command fails as when Docker Desktop is not running. */
    stop() {
      host.daemonDown = true;
    },
    /** How the next rebuilds go: the lines they print, held until `finish`, and how they end. */
    composeWill(next: Partial<Host['compose']>) {
      host.compose = { ...host.compose, ...next };
    },
    /** Ends the held rebuild, or the held start or stop. */
    finish(result: DockerResult = ok()) {
      host.release?.(result);
      host.release = undefined;
    },
    reset() {
      calls.length = 0;
      containers.clear();
      host.daemonDown = false;
      Object.assign(host, fresh());
    },
  };
}

export type FakeDocker = ReturnType<typeof fakeDocker>;

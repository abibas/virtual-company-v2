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

/** `docker inspect --type container <id>`'s answer for one container runner. */
export function inspectJson(c: RecordedContainer): string {
  const folder = c.folder ?? c.files.slice(0, c.files.lastIndexOf('/'));
  return JSON.stringify([
    {
      Id: `${c.id}${'0'.repeat(64 - c.id.length)}`,
      Created: '2026-11-10T12:52:37.123456789Z',
      Name: `/${c.project}-runner-local-1`,
      State: { Status: 'running', Running: true },
      Config: {
        Hostname: c.id.slice(0, 12),
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

/** The fake Docker host: its containers by id, the projects' runner containers, and how compose ends. */
export function fakeDocker() {
  const calls: DockerCall[] = [];
  const containers = new Map<string, string>();
  let daemonDown = false;
  let release: ((result: DockerResult) => void) | undefined;
  let compose: { lines: readonly string[]; hold: boolean; result: DockerResult | 'reject' } = {
    lines: [],
    hold: false,
    result: ok(),
  };
  const projectOf = (json: string) =>
    (JSON.parse(json) as { Config: { Labels: Record<string, string> } }[])[0]?.Config.Labels[
      'com.docker.compose.project'
    ];
  const docker: LocalDocker = {
    path: '/usr/local/bin/docker',
    async run(args, options) {
      calls.push({ args, env: options.env, timeoutMs: options.timeoutMs });
      if (daemonDown) return failed('Cannot connect to the Docker daemon at unix:///var/run/docker.sock');
      if (args[0] === 'inspect') {
        const json = containers.get(args.at(-1) ?? '');
        return json === undefined ? failed(`Error: No such container: ${args.at(-1)}`) : ok(json);
      }
      if (args[0] === 'ps') {
        const project = args
          .find((arg) => arg.startsWith('label=com.docker.compose.project='))
          ?.split('=')[2];
        const ids = [...containers].filter(([, json]) => projectOf(json) === project).map(([id]) => id);
        return ok(ids.length === 0 ? '' : `${ids.join('\n')}\n`);
      }
      for (const line of compose.lines) options.onLine?.(line);
      if (compose.result === 'reject') throw new Error('spawn failed oddly');
      if (!compose.hold) return compose.result;
      return new Promise<DockerResult>((resolve) => {
        release = resolve;
      });
    },
  };
  return {
    docker,
    calls,
    /** The compose calls (the rebuilds). */
    rebuilds: () => calls.filter((call) => call.args[0] === 'compose'),
    /** A container Docker knows, under its short id. */
    add(container: RecordedContainer) {
      containers.set(container.id.slice(0, 12), inspectJson(container));
    },
    /** Every command fails as when Docker Desktop is not running. */
    stop() {
      daemonDown = true;
    },
    /** How the next rebuilds go: the lines they print, held until `finish`, and how they end. */
    composeWill(next: Partial<typeof compose>) {
      compose = { ...compose, ...next };
    },
    /** Ends the held rebuild. */
    finish(result: DockerResult = ok()) {
      release?.(result);
      release = undefined;
    },
    reset() {
      calls.length = 0;
      containers.clear();
      daemonDown = false;
      compose = { lines: [], hold: false, result: ok() };
    },
  };
}

export type FakeDocker = ReturnType<typeof fakeDocker>;

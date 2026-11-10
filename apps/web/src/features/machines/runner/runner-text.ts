import type { LatestRunner, Machine } from '../../../api/types.ts';

/** When a machine card offers to update its runner, what it says while it does, and how runner versions read (pure). */

/**
 * True when the runner needs the update: it is connected and runs another build than the one the server hands out,
 * says no build at all (a runner older than build reporting; one run from its sources says none either, and its update
 * is refused with the command to run), or has no terminal. An offline machine says nothing: its runner is unknown.
 */
export function runnerOutOfDate(machine: Pick<Machine, 'runner'>, online: boolean): boolean {
  const { current, build, terminal } = machine.runner;
  return online && (current === false || build === null || !terminal);
}

const BUILT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** A build time in local time, "9 Nov 16:40". */
export function builtAtText(iso: string): string {
  const parts = Object.fromEntries(BUILT.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

/** A version with its build time: "0.5.0 · built 9 Nov 16:40", or "0.5.0 · build unknown" without one. */
export function versionText(version: string, builtAt: string | null): string {
  return `${version} · ${builtAt ? `built ${builtAtText(builtAt)}` : 'build unknown'}`;
}

/** The out-of-date badge: with the latest version and build time when the server knows them. */
export function outOfDateText(latest: LatestRunner): string {
  return latest
    ? `Runner out of date · latest ${versionText(latest.version, latest.builtAt)}`
    : 'Runner out of date';
}

/** True when the runner runs the build the server hands out and opens terminals: the "up to date" badge. */
export function runnerUpToDate(machine: Pick<Machine, 'runner'>, online: boolean): boolean {
  return online && machine.runner.current === true && machine.runner.terminal;
}

/**
 * True for a container whose runner is out of date: its runner is updated by rebuilding the container, and a runner
 * that old may not install CLIs in place yet, so the card offers Update container before an install.
 */
export function containerFirst(machine: Pick<Machine, 'runner' | 'kind'>, online: boolean): boolean {
  return machine.kind === 'container' && runnerOutOfDate(machine, online);
}

/** What Update container does, under the container's Runner row. */
export const CONTAINER_UPDATE_INFO =
  'Rebuilds its image with the new runner and recreates it; keeps its enrollment, /work and installed CLIs. Takes a minute or two.';

/** How long after an update the card loads again: the runner restarts about 10 s after it (its service's wait). */
export const RELOAD_AFTER_MS = 15_000;

/** What the card says once the server did its part (a container's rebuild goes on after it: the card follows it). */
export const UPDATED_TEXT: Readonly<Record<'self_update' | 'ssh_reinstall' | 'docker_rebuild', string>> = {
  self_update:
    'The runner put the new build in place and is restarting. This card shows it in a few seconds.',
  ssh_reinstall:
    'The runner was reinstalled on the box and is restarting. This card shows it in a few seconds.',
  docker_rebuild:
    'Rebuilding the container with the new runner. This card follows it; it takes a minute or two.',
};

import { useEffect, useRef } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import type {
  InstallableTool,
  LatestRunner,
  Machine,
  MachineChanges,
  MachinePower,
  MachineStatsList,
  PowerEvent,
  PowerPolicy,
} from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The company's machines (docs/machines.md): the list, the home board's stats, each machine's power and log, and the
 * changes admins make. The stats refresh every minute while the tab is visible.
 */

/** How often the board asks for the stats again; the runners sample once a minute. */
export const STATS_EVERY_MS = 60_000;

/** How often the Machines page reads the machines again while a job runs on one (an install, a runner update). */
export const JOBS_EVERY_MS = 3_000;

/**
 * Calls `tick` every `everyMs` while the tab is visible, and at once when it shows again after a longer absence.
 * Nothing while `enabled` is false.
 */
export function useVisibleInterval(tick: () => void, everyMs: number, enabled = true) {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    const run = () => {
      last = Date.now();
      latest.current();
    };
    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, everyMs);
    const onVisibility = () => {
      if (!document.hidden && Date.now() - last >= everyMs) run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [everyMs, enabled]);
}

/**
 * The machines, by name, and the latest runner the server hands out. With `follow` (the Machines page) they are read
 * again every minute while the tab is visible, so a rebuilt runner bundle or a runner that came back shows without a
 * reload, and every 3 s while a job runs on one (a container's rebuild shows its progress).
 */
export function useMachines(
  companyId: string,
  options: { readonly follow?: boolean } = {},
): Loaded<{ readonly machines: readonly Machine[]; readonly latestRunner: LatestRunner }> {
  const api = useApi();
  const loaded = useLoad(`machines:${companyId}`, () => machineCalls(api, companyId).list());
  const busy = loaded.data?.machines.some((machine) => machine.runner.job != null) ?? false;
  useVisibleInterval(loaded.reload, busy ? JOBS_EVERY_MS : STATS_EVERY_MS, options.follow === true);
  return loaded;
}

/** Every machine's stats for the board, again every minute while the tab is visible. */
export function useMachineStats(companyId: string): Loaded<MachineStatsList> {
  const api = useApi();
  const loaded = useLoad(`machine-stats:${companyId}`, () =>
    call(api.api.companies[':companyId'].machines.stats.$get({ param: { companyId } })),
  );
  useVisibleInterval(loaded.reload, STATS_EVERY_MS);
  return loaded;
}

/** A machine's power: its policy, hold, box and controller, and whether the caller may change them. */
export function useMachinePower(companyId: string, machineId: string): Loaded<MachinePower> {
  const api = useApi();
  return useLoad(`machine-power:${companyId}:${machineId}`, () =>
    call(
      api.api.companies[':companyId'].machines[':machineId'].power.$get({ param: { companyId, machineId } }),
    ),
  );
}

/** A machine's last 10 power events, newest first. */
export function useMachineEvents(
  companyId: string,
  machineId: string,
): Loaded<{ readonly events: readonly PowerEvent[] }> {
  const api = useApi();
  return useLoad(`machine-events:${companyId}:${machineId}`, () =>
    call(
      api.api.companies[':companyId'].machines[':machineId'].events.$get({
        param: { companyId, machineId },
        query: {},
      }),
    ),
  );
}

export interface PowerControl {
  readonly power: Loaded<MachinePower>;
  readonly events: Loaded<{ readonly events: readonly PowerEvent[] }>;
  /** Each change throws the server's refusal; the power and the log load again after it either way. */
  start(): Promise<void>;
  /** `force`: a container's Stop while chat turns or terminals run on it (they end). */
  stop(force?: boolean): Promise<void>;
  setPolicy(policy: PowerPolicy): Promise<void>;
  setTimezone(timezone: string): Promise<void>;
}

/**
 * A machine's power and log, read again every minute while the tab is visible (the box starts and stops in minutes,
 * the scheduler logs on its own), with the admin's changes to them, each followed by a fresh read of both.
 */
export function usePowerControl(companyId: string, machineId: string): PowerControl {
  const calls = machineCalls(useApi(), companyId);
  const power = useMachinePower(companyId, machineId);
  const events = useMachineEvents(companyId, machineId);
  const again = () => {
    power.reload();
    events.reload();
  };
  useVisibleInterval(again, STATS_EVERY_MS);
  const then = async (change: Promise<unknown>) => {
    try {
      await change;
    } finally {
      again();
    }
  };
  return {
    power,
    events,
    start: () => then(calls.start(machineId)),
    stop: (force) => then(calls.stop(machineId, force)),
    setPolicy: (policy) => then(calls.setPolicy(machineId, policy)),
    setTimezone: (timezone) => then(calls.setTimezone(machineId, timezone)),
  };
}

/**
 * The calls on the machines: the list, a token to enroll one, a rename, a removal, the power policy and commands, an
 * owner's one-time terminal ticket, the update of a machine's runner, its folders (a listing and a new folder, read
 * and made by its runner), and its tools (a check, an install and its progress).
 */
export function machineCalls(api: Api, companyId: string) {
  const machines = api.api.companies[':companyId'].machines;
  const one = machines[':machineId'];
  const param = (machineId: string) => ({ param: { companyId, machineId } });
  return {
    list: () => call(machines.$get({ param: { companyId } })),
    createToken: () => call(machines['enrollment-tokens'].$post({ param: { companyId } })),
    update: (machineId: string, changes: MachineChanges) =>
      call(one.$patch({ ...param(machineId), json: changes })),
    remove: (machineId: string) => call(one.$delete(param(machineId))),
    power: (machineId: string) => call(one.power.$get(param(machineId))),
    setPolicy: (machineId: string, policy: PowerPolicy) =>
      call(one.power.$put({ ...param(machineId), json: policy })),
    start: (machineId: string) => call(one.power.start.$post({ ...param(machineId), json: {} })),
    stop: (machineId: string, force = false) =>
      call(one.power.stop.$post({ ...param(machineId), json: force ? { force } : {} })),
    setTimezone: (machineId: string, timezone: string) =>
      call(one.power.timezone.$post({ ...param(machineId), json: { timezone } })),
    terminalTicket: (machineId: string) => call(one['terminal-tickets'].$post(param(machineId))),
    updateRunner: (machineId: string) => call(one['runner-update'].$post({ ...param(machineId), json: {} })),
    /** The folders in `path` (the runner's default start when left out). */
    folders: (machineId: string, path?: string) =>
      call(one.folders.$get({ ...param(machineId), query: path === undefined ? {} : { path } })),
    makeFolder: (machineId: string, path: string) =>
      call(one.folders.$post({ ...param(machineId), json: { path } })),
    /** Has the runner look for its CLIs again. */
    checkTools: (machineId: string) => call(one.tools.check.$post(param(machineId))),
    /** Installs (or updates) Claude Code or Codex at the server's pin; its output through `toolInstall`. */
    installTool: (machineId: string, tool: InstallableTool) =>
      call(one.tools.install.$post({ ...param(machineId), json: { tool } })),
    /** An install: its state and its output from line `from` on. */
    toolInstall: (machineId: string, installId: string, from: number) =>
      call(
        one.tools.install[':installId'].$get({
          param: { companyId, machineId, installId },
          query: { from: String(from) },
        }),
      ),
  };
}

export type MachineCalls = ReturnType<typeof machineCalls>;

import { useEffect, useMemo, useState } from 'react';
import { useApi } from './context.ts';
import { ApiError } from './errors.ts';
import { machineCalls, useVisibleInterval } from './machines.ts';
import type { MachineChoice, MachinePower } from './types.ts';
import { useLoad } from './use-load.ts';

/**
 * Waking an offline machine from where its agent is placed (the agent form): its power while it is offline (who may
 * start it, what it costs, Docker's or the box's state), a Start, then the machines read again every few seconds until
 * its runner connects or 5 minutes pass. One per form, shared by the machine select and the folder browser.
 */

/** How often the machines are read again while one starts. */
export const WAKE_EVERY_MS = 5_000;

/** How long a start may take before it shows as failed, with a Retry. */
export const WAKE_TIMEOUT_MS = 5 * 60_000;

/** `idle`: nothing asked; `starting` since `startedAt`; `failed` with the refusal; `late` after the timeout. */
export type WakePhase = 'idle' | 'starting' | 'failed' | 'late';

export interface MachineWake {
  /** The machine's power, loaded while it is offline. */
  readonly power: MachinePower | undefined;
  readonly phase: WakePhase;
  /** When the start (or the wait for one already under way) began, in ms. */
  readonly startedAt: number | undefined;
  /** The start's refusal, while `failed`. */
  readonly failure: unknown;
  /** Starts the machine and waits for its runner. */
  start(): void;
  /** Reads the machines and the power again (Check again). */
  check(): void;
}

interface WakeState {
  readonly machineId: string;
  readonly phase: WakePhase;
  readonly startedAt: number | undefined;
  readonly failure: unknown;
}

const idle = (machineId: string): WakeState => ({
  machineId,
  phase: 'idle',
  startedAt: undefined,
  failure: undefined,
});

/** A dropped connection or a gateway's timeout: the start may still be under way, so the wait goes on. */
const lostAnswer = (failure: unknown) =>
  failure instanceof ApiError &&
  (failure.code === 'network' || (failure.code === 'http_error' && failure.status === 504));

/** Docker's or the box's state says a start is already under way. */
const underWay = (power: MachinePower | undefined) =>
  power?.box?.status === 'starting' || power?.container?.status === 'starting';

/**
 * The wake of the chosen machine. `reloadMachines` reads the machine list again (the select's own load): the machine
 * counts as up the moment its status there is no longer offline.
 */
export function useMachineWake(
  companyId: string,
  machine: MachineChoice | undefined,
  reloadMachines: () => void,
): MachineWake {
  const api = useApi();
  const calls = useMemo(() => machineCalls(api, companyId), [api, companyId]);
  const machineId = machine?.id ?? '';
  const offline = machine?.status === 'offline';
  const power = useLoad(`wake-power:${companyId}:${machineId}:${offline}`, () =>
    offline ? calls.power(machineId) : Promise.resolve(undefined),
  );
  const [stored, setState] = useState<WakeState>(() => idle(machineId));
  const state = stored.machineId === machineId ? stored : idle(machineId);
  const set = (next: Omit<WakeState, 'machineId'>) => setState({ machineId, ...next });

  // Up: back to idle. A start someone else began: wait for it too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: it follows the machine's status and its power only.
  useEffect(() => {
    if (!offline && state.phase !== 'idle') set({ phase: 'idle', startedAt: undefined, failure: undefined });
    else if (offline && state.phase === 'idle' && underWay(power.data))
      set({ phase: 'starting', startedAt: Date.now(), failure: undefined });
  }, [offline, power.data]);

  useVisibleInterval(
    () => {
      if (state.startedAt !== undefined && Date.now() - state.startedAt > WAKE_TIMEOUT_MS) {
        set({ phase: 'late', startedAt: state.startedAt, failure: undefined });
        power.reload();
      } else reloadMachines();
    },
    WAKE_EVERY_MS,
    state.phase === 'starting',
  );

  const start = async () => {
    const startedAt = Date.now();
    setState({ machineId, phase: 'starting', startedAt, failure: undefined });
    try {
      await calls.start(machineId);
    } catch (failure) {
      if (!lostAnswer(failure)) {
        setState((now) =>
          now.machineId === machineId && now.startedAt === startedAt
            ? { machineId, phase: 'failed', startedAt, failure }
            : now,
        );
      }
    } finally {
      power.reload();
      reloadMachines();
    }
  };

  return {
    power: offline ? power.data : undefined,
    phase: state.phase,
    startedAt: state.startedAt,
    failure: state.failure,
    start: () => void start(),
    check: () => {
      reloadMachines();
      power.reload();
    },
  };
}

/**
 * The server's own power driver in tests: a `LocalPower` whose driver is the one the test last chose (`use`, a
 * `FakePowerDriver`), whose tunnel holder records every set it is given (nothing is started) and lets the test
 * report a tunnel's state as the supervisor would, and whose runner reinstall records its calls and answers what the
 * test says (`reinstalls`, `reinstallAnswers`).
 */
import type { MachinePowerDriver } from '@mwc/machines-core';
import type { AiriaDevboxRef } from '@mwc/shared/machines';
import type { TunnelSpec, TunnelState, TunnelStatus } from '@mwc/shared/runner-protocol';
import { LOCAL_POWER_NAME, type LocalPower, type ReinstallPorts } from '../../../src/platform/power/local.ts';
import type { RunOutcome } from '../../../src/platform/power/reinstall.ts';

export interface FakeLocalPower {
  readonly local: LocalPower;
  /** Drives the boxes with `driver` from now on. */
  use(driver: MachinePowerDriver): void;
  /** Every set the holder was given, in order, as the machines they name. */
  readonly sets: TunnelSpec[][];
  /** The set held now. */
  held(): TunnelSpec[];
  /** Reports a tunnel's state, as the supervisor does when its process starts, stays up or ends. */
  report(machineId: string, state: TunnelStatus, error?: string): void;
  /** How many times the holder was closed. */
  closed(): number;
  /** Every runner reinstall asked for, in order. */
  readonly reinstalls: { readonly ref: AiriaDevboxRef; readonly ports: ReinstallPorts }[];
  /** What the next reinstalls answer, in turn; ok once they run out. */
  readonly reinstallAnswers: RunOutcome[];
}

export function fakeLocalPower(first: MachinePowerDriver): FakeLocalPower {
  const sets: TunnelSpec[][] = [];
  let current = first;
  let reportTo: ((state: TunnelState) => void) | undefined;
  let closed = 0;
  const reinstalls: FakeLocalPower['reinstalls'] = [];
  const reinstallAnswers: RunOutcome[] = [];
  const driver: MachinePowerDriver = {
    provider: 'airia_devbox',
    discover: () => current.discover(),
    status: (ref) => current.status(ref),
    start: (ref) => current.start(ref),
    stop: (ref) => current.stop(ref),
    setTimezone: (ref, timezone) => current.setTimezone(ref, timezone),
  };
  const local: LocalPower = {
    name: LOCAL_POWER_NAME,
    driver,
    tunnels(report) {
      reportTo = report;
      return {
        set: (tunnels) => void sets.push([...tunnels]),
        close: async () => {
          closed++;
        },
      };
    },
    reinstallRunner: async (ref, ports) => {
      reinstalls.push({ ref, ports });
      return reinstallAnswers.shift() ?? { ok: true };
    },
  };
  return {
    local,
    use: (next) => {
      current = next;
    },
    sets,
    held: () => sets.at(-1) ?? [],
    report: (machineId, state, error) =>
      reportTo?.({ type: 'tunnel.state', machineId, state, ...(error ? { error } : {}) }),
    closed: () => closed,
    reinstalls,
    reinstallAnswers,
  };
}

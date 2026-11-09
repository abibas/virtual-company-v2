import type { AiriaDevboxRef, DevboxSize, PowerProvider, PowerStatus } from '@mwc/shared/machines';
import type { BoxRules } from './rules.ts';

/**
 * Where a machine is at its provider (`machines.provider_ref`). Only the Airia devbox has power today; a second
 * provider makes this a union.
 */
export type PowerRef = AiriaDevboxRef;

/** What a driver reads about a machine: its power state, its size and hourly cost when known, its own stop rules. */
export interface PowerReading {
  readonly status: PowerStatus;
  readonly size?: DevboxSize;
  /** In US dollars an hour, when the size is known. */
  readonly hourlyCost?: number;
  /** The box's own stop rules from its metadata; null when the machine is missing. */
  readonly rules: BoxRules | null;
  /** True when `start` or `stop` found the machine already there (up or coming up, down or going down): nothing ran. */
  readonly already?: true;
}

/** A machine `discover()` found for the signed-in account, with where it is. */
export interface DiscoveredMachine extends PowerReading {
  readonly ref: PowerRef;
}

/** The ports of a reverse tunnel: the machine's `127.0.0.1:remotePort` leads to the controller's `127.0.0.1:localPort`. */
export interface TunnelPorts {
  readonly remotePort: number;
  readonly localPort: number;
}

/** A long-lived process for the controller to run: the program by its full path, its arguments (no shell), its environment. */
export interface ProcessCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** The whole environment it gets; the runner's own when left out. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The machine power port (docs/machines.md): what a power controller (the runner on This Mac) calls to act on
 * another machine. Every method rejects with a `MachinePowerError` only. `start` and `stop` return without waiting
 * for the provider, with the reading after the command (`starting` / `stopping` while it is still at it); they do
 * nothing to a machine already there (their reading then says `already`), and never create one: a missing machine
 * rejects with `not_found`.
 */
export interface MachinePowerDriver {
  readonly provider: PowerProvider;
  /** The machines of the signed-in account at this provider. */
  discover(): Promise<DiscoveredMachine[]>;
  /** The machine's state now; `missing` (not a rejection) when the provider has no such machine. */
  status(ref: PowerRef): Promise<PowerReading>;
  start(ref: PowerRef): Promise<PowerReading>;
  stop(ref: PowerRef): Promise<PowerReading>;
  /** Sets the box's own time zone (the devbox's `devbox-tz`), an IANA name; the box applies it at its next check. */
  setTimezone(ref: PowerRef, timezone: string): Promise<PowerReading>;
  /**
   * The command of a reverse tunnel to the machine (pure: nothing runs), for a provider whose machines reach the
   * server only through one; the controller's runner starts and supervises it. It never starts a stopped machine.
   */
  tunnelCommand?(ref: PowerRef, ports: TunnelPorts): ProcessCommand;
  /**
   * The one-off command that ends whatever listens on the machine's `127.0.0.1:remotePort` (pure: nothing runs): a
   * stale session of an earlier tunnel that the machine never saw end. The supervisor runs it only after a tunnel
   * failed because that port was taken, so never while one of its tunnels holds it. Optional like `tunnelCommand`.
   */
  clearPortCommand?(ref: PowerRef, remotePort: number): ProcessCommand;
}

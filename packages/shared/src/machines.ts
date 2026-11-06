import { z } from 'zod';
import { MachineProvider } from './enums.ts';
import { EpochMs } from './identity.ts';

/**
 * The machines contract (docs/machines.md): the enums the machines tables, the runner protocol and the API share,
 * a runner's per-minute sample, and a machine's power policy with its defaults. Fields are camelCase, as in every
 * `@mwc/shared` contract; the database columns are their snake_case names.
 */

// The enums stored in the machines tables live in ./enums.ts with the other database enums (their CHECKs are built
// from `.options`); this module keeps exporting them, since they are part of the machines contract.
export { MachineKind, MachineProvider, MachineStatus, PowerEventAction } from './enums.ts';

/** The providers a power controller can drive: every `MachineProvider` but `none`. */
export const PowerProvider = MachineProvider.exclude(['none']);
export type PowerProvider = z.infer<typeof PowerProvider>;

/** What a power controller is asked to do with a machine (`power.command`). */
export const PowerAction = z.enum(['start', 'stop', 'status', 'set_timezone']);
export type PowerAction = z.infer<typeof PowerAction>;

/**
 * A machine's power state as its provider reports it (`power.result`), mapped from the provider's own words (for the
 * devbox, gcloud's RUNNING, STOPPED, STAGING and so on); `missing` when the provider has no such machine.
 */
export const PowerStatus = z.enum(['running', 'stopped', 'starting', 'stopping', 'missing', 'unknown']);
export type PowerStatus = z.infer<typeof PowerStatus>;

/**
 * How a runner keeps its machine awake while held (`runner.hello.caps.hold`): the devbox's own
 * `devbox-keepalive`, a `caffeinate` child on macOS, or nothing (a container).
 */
export const HoldDriver = z.enum(['devbox_keepalive', 'caffeinate', 'none']);
export type HoldDriver = z.infer<typeof HoldDriver>;

/** The Airia devbox's sizes (`airia devbox up --size`), $0.134 to $1.073 an hour. */
export const DevboxSize = z.enum(['s', 'm', 'l', 'xl']);
export type DevboxSize = z.infer<typeof DevboxSize>;

/** Where an Airia devbox is (`machines.provider_ref`): its gcloud instance (`dev-<you>`), zone and size. */
export const AiriaDevboxRef = z.object({
  instance: z.string().regex(/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/, 'a gcloud instance name'),
  zone: z.string().regex(/^[a-z]+-[a-z]+\d+-[a-z]$/, 'a gcloud zone such as europe-west1-b'),
  size: DevboxSize.optional(),
});
export type AiriaDevboxRef = z.infer<typeof AiriaDevboxRef>;

const Percent = z.number().min(0).max(100);
const Load = z.number().nonnegative();
const Bytes = z.int().nonnegative();

/**
 * One sample of a machine, taken by its runner once a minute and sent in a heartbeat (`machine_samples`). Loads are
 * the 1, 5 and 15 minute averages; CPU from `os.cpus()` deltas; memory and disk in use, disk sizes in bytes.
 */
export const MachineSample = z.object({
  load1: Load,
  load5: Load,
  load15: Load,
  cpus: z.int().min(1),
  cpuPct: Percent,
  memPct: Percent,
  diskUsed: Bytes,
  diskTotal: Bytes,
  uptimeS: z.int().nonnegative(),
  /** How many runs were live on the machine. */
  liveRuns: z.int().nonnegative(),
  /** When it was taken, in milliseconds; the server keeps one sample per machine and minute. */
  at: EpochMs,
});
export type MachineSample = z.infer<typeof MachineSample>;

/** A time of day, `HH:MM` on a 24-hour clock. */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM');

/** A day of the week, ISO 8601: 1 is Monday, 7 is Sunday. */
export const Weekday = z.int().min(1).max(7);

/** True for an IANA time zone name the runtime knows (`Europe/Kyiv`, `UTC`); offsets such as `+02:00` are not names. */
export function isTimeZone(name: string): boolean {
  if (!/^[A-Za-z]/.test(name)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone name, checked with `Intl`. */
export const TimeZone = z.string().max(64).refine(isTimeZone, 'an IANA time zone such as Europe/Kyiv');

/** The longest hold after a turn: 12 hours. */
export const HOLD_AFTER_TURN_MAX_MIN = 720;

/**
 * The keep-on hours: on the listed days, from `from` to `to` in `timezone`, the machine is kept on (started when
 * `autoStartAtKeepOn`, held, stopped at the end when `stopAtKeepOnEnd`). `to` before `from` is a window overnight.
 */
export const KeepOnWindow = z
  .object({
    enabled: z.boolean().default(false),
    days: z
      .array(Weekday)
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'each day once')
      .default([1, 2, 3, 4, 5]),
    from: TimeOfDay.default('09:00'),
    to: TimeOfDay.default('19:00'),
    timezone: TimeZone.default('Europe/Kyiv'),
  })
  .refine((window) => window.from !== window.to, { message: 'from and to differ', path: ['to'] });
export type KeepOnWindow = z.infer<typeof KeepOnWindow>;

/**
 * A machine's power policy (`machine_power.policy`), v1's shape. Every field has its default, so `{}` parses to the
 * policy a new machine gets: keep-on hours off (Mon–Fri 09:00–19:00 Europe/Kyiv), a 45-minute hold after each turn,
 * This Mac kept awake, no automatic start of any kind (starting a box costs money), a stop when the hours end.
 */
export const MachinePowerPolicy = z.object({
  keepOn: KeepOnWindow.prefault({}),
  holdAfterTurnMin: z.int().min(0).max(HOLD_AFTER_TURN_MAX_MIN).default(45),
  keepMacAwake: z.boolean().default(true),
  autoStartAtKeepOn: z.boolean().default(false),
  autoStartOnWork: z.boolean().default(false),
  autoStartOnMessage: z.boolean().default(false),
  stopAtKeepOnEnd: z.boolean().default(true),
});
export type MachinePowerPolicy = z.infer<typeof MachinePowerPolicy>;
export type MachinePowerPolicyInput = z.input<typeof MachinePowerPolicy>;

/** The policy a new machine gets. */
export const DEFAULT_MACHINE_POWER_POLICY: MachinePowerPolicy = MachinePowerPolicy.parse({});

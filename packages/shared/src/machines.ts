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
export {
  HoldSource,
  MachineKind,
  MachineProvider,
  MachineStatus,
  PlacementMode,
  PowerEventAction,
} from './enums.ts';

/** A machine's name (`machines.name`): what people call it, 1–80 characters. */
export const MACHINE_NAME = { min: 1, max: 80 } as const;

/** A folder of an agent's placement (`agent_placements.home`, `config_dir`, `worktree_root`): 1–500 characters. */
export const PLACEMENT_PATH = { min: 1, max: 500 } as const;

/** The pattern of a placement's folder: an absolute path on its machine, on one line. */
export const ABSOLUTE_PATH_PATTERN = /^\/[^\n\r\0]*$/;

/** A placement's folder: an absolute path on its machine (`/Users/ihor/agents/slop-box`), trimmed, 1–500 characters. */
export const PlacementPath = z
  .string()
  .trim()
  .min(PLACEMENT_PATH.min)
  .max(PLACEMENT_PATH.max)
  .regex(ABSOLUTE_PATH_PATTERN, 'an absolute path, starting with /');

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

/**
 * The CLIs a machine's runner reports (`caps.tools`, docs/machines.md "Tools"), by their commands: Claude Code
 * (`claude`), Codex (`codex`), git, GitHub's CLI (`gh`) and Docker.
 */
export const MachineTool = z.enum(['claude', 'codex', 'git', 'gh', 'docker']);
export type MachineTool = z.infer<typeof MachineTool>;

/** The CLIs a runner installs (or updates) from the Machines page: Claude Code and Codex, with npm. */
export const InstallableTool = MachineTool.extract(['claude', 'codex']);
export type InstallableTool = z.infer<typeof InstallableTool>;

/**
 * Each installable CLI's npm package and the version the Machines page installs: the versions `deploy/Dockerfile.login`
 * and `deploy/Dockerfile.runner` pin, so the machines and the sign-in helper run the same CLIs. Raise them together.
 */
export const TOOL_PACKAGES: Readonly<
  Record<InstallableTool, { readonly name: string; readonly version: string }>
> = {
  claude: { name: '@anthropic-ai/claude-code', version: '2.1.308' },
  codex: { name: '@openai/codex', version: '0.163.0' },
};

/** The first `1.2.3`-like number in what a CLI printed (`2.1.319 (Claude Code)`, `codex-cli 0.163.0`), or undefined. */
export function toolVersionNumber(printed: string): string | undefined {
  return /\d+\.\d+(?:\.\d+)?/.exec(printed)?.[0];
}

/** Numeric order of two dotted versions (`0.163.0` against `0.162.1`): negative, zero or positive. */
function compareDotted(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const order = (left[i] ?? 0) - (right[i] ?? 0);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * True when what a CLI printed names a version older than `pinned` (the one this server installs); false for the same,
 * a newer one, or a text without a version (nothing to compare).
 */
export function toolNeedsUpdate(printed: string, pinned: string): boolean {
  const found = toolVersionNumber(printed);
  return found !== undefined && compareDotted(found, pinned) < 0;
}

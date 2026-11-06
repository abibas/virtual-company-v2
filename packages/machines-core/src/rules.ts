import { isTimeZone } from '@mwc/shared/machines';

/**
 * A box's own stop rules, read from its instance metadata (the Airia devbox's `devbox-idle-check`): it halts after
 * `idleShutdownMin` idle minutes in work hours (`workStartHour` to `workEndHour` in `timezone`), after
 * `idleOffhoursMin` outside them, and every night from `nightlyStopHour`; a load1 above `idleLoadThreshold` counts
 * as activity. The app shows them read-only; only the time zone is changed from here (`setTimezone`).
 */
export interface BoxRules {
  /** `devbox-tz`, an IANA time zone. */
  readonly timezone: string;
  /** `idle-shutdown-min`. */
  readonly idleShutdownMin: number;
  /** `idle-offhours-min`. */
  readonly idleOffhoursMin: number;
  /** `idle-load-threshold`. */
  readonly idleLoadThreshold: number;
  /** `work-start-hour`, 0 to 23. */
  readonly workStartHour: number;
  /** `work-end-hour`, 0 to 23. */
  readonly workEndHour: number;
  /** `nightly-stop-hour`, 0 to 23. */
  readonly nightlyStopHour: number;
}

/** The rules a box has when its metadata does not say (the airia CLI's own defaults). */
export const DEFAULT_BOX_RULES: BoxRules = {
  timezone: 'America/Chicago',
  idleShutdownMin: 45,
  idleOffhoursMin: 20,
  idleLoadThreshold: 0.5,
  workStartHour: 8,
  workEndHour: 19,
  nightlyStopHour: 20,
};

/** One instance metadata entry, as GCE lists it (`metadata.items`). */
export interface MetadataItem {
  readonly key: string;
  readonly value?: string | undefined;
}

/** The metadata key of each rule. */
export const BOX_RULE_KEYS: Readonly<Record<keyof BoxRules, string>> = {
  timezone: 'devbox-tz',
  idleShutdownMin: 'idle-shutdown-min',
  idleOffhoursMin: 'idle-offhours-min',
  idleLoadThreshold: 'idle-load-threshold',
  workStartHour: 'work-start-hour',
  workEndHour: 'work-end-hour',
  nightlyStopHour: 'nightly-stop-hour',
};

type NumberRule = Exclude<keyof BoxRules, 'timezone'>;

function isHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** The values each number rule accepts; anything else falls back to its default. */
const NUMBER_RULES: readonly (readonly [NumberRule, (value: number) => boolean])[] = [
  ['idleShutdownMin', isPositiveInt],
  ['idleOffhoursMin', isPositiveInt],
  ['idleLoadThreshold', (value) => value >= 0],
  ['workStartHour', isHour],
  ['workEndHour', isHour],
  ['nightlyStopHour', isHour],
];

/**
 * A box's rules from its metadata items: each rule from its key, or its default when the key is absent or its value
 * does not parse (a time zone `Intl` does not know, a number out of range). Pure.
 */
export function boxRulesFromMetadata(items: readonly MetadataItem[] | undefined): BoxRules {
  const values = new Map<string, string>();
  for (const item of items ?? []) if (item.value !== undefined) values.set(item.key, item.value.trim());
  const timezone = values.get(BOX_RULE_KEYS.timezone);
  const numbers: Record<NumberRule, number> = { ...DEFAULT_BOX_RULES };
  for (const [rule, valid] of NUMBER_RULES) {
    const text = values.get(BOX_RULE_KEYS[rule]);
    const value = text === undefined || text === '' ? Number.NaN : Number(text);
    if (Number.isFinite(value) && valid(value)) numbers[rule] = value;
  }
  return {
    ...numbers,
    timezone: timezone !== undefined && isTimeZone(timezone) ? timezone : DEFAULT_BOX_RULES.timezone,
  };
}

import { useId, useMemo } from 'react';
import type { PowerPolicy } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { Field } from '../../../components/forms/Field.tsx';
import { Input, Select } from '../../../components/forms/Input.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { DAYS, timeZones } from './power-text.ts';

/** The keep-on hours of a machine's power settings: on or off, the days, from and to, and the time zone. */

type KeepOn = PowerPolicy['keepOn'];

/** The keep-on days as toggle chips; at least one stays on. */
function DayChips({
  days,
  onChange,
  disabled,
}: {
  readonly days: readonly number[];
  readonly onChange: (days: number[]) => void;
  readonly disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-wrap gap-1.5" disabled={disabled}>
      <legend className="sr-only">Keep-on days</legend>
      {DAYS.map(({ day, label }) => {
        const on = days.includes(day);
        const next = on ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            disabled={disabled || (on && days.length === 1)}
            onClick={() => onChange(next)}
            className={cx(
              'h-7 cursor-pointer rounded-full px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed',
              on ? 'bg-blue text-on-blue' : 'bg-surface-3 text-dim hover:text-ink',
              disabled && 'opacity-70',
            )}
          >
            {label}
          </button>
        );
      })}
    </fieldset>
  );
}

/** The keep-on hours: on or off, the days, from and to, and their time zone. */
export function KeepOnFields({
  keepOn,
  onChange,
  disabled,
}: {
  readonly keepOn: KeepOn;
  readonly onChange: (keepOn: KeepOn) => void;
  readonly disabled: boolean;
}) {
  const id = useId();
  const zones = useMemo(() => timeZones(keepOn.timezone), [keepOn.timezone]);
  const set = (change: Partial<KeepOn>) => onChange({ ...keepOn, ...change });
  return (
    <div className="flex flex-col gap-3">
      <Switch
        label="Keep-on hours"
        checked={keepOn.enabled}
        disabled={disabled}
        onChange={(enabled) => set({ enabled })}
      />
      <DayChips days={keepOn.days} disabled={disabled} onChange={(days) => set({ days })} />
      <div className="grid gap-3 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]">
        <Field id={`${id}-from`} label="From">
          <Input
            id={`${id}-from`}
            type="time"
            size="sm"
            value={keepOn.from}
            disabled={disabled}
            onChange={(e) => set({ from: e.target.value })}
          />
        </Field>
        <Field id={`${id}-to`} label="To">
          <Input
            id={`${id}-to`}
            type="time"
            size="sm"
            value={keepOn.to}
            disabled={disabled}
            onChange={(e) => set({ to: e.target.value })}
          />
        </Field>
        <Field id={`${id}-zone`} label="Time zone">
          <Select
            id={`${id}-zone`}
            size="sm"
            value={keepOn.timezone}
            disabled={disabled}
            options={zones.map((zone) => ({ value: zone, label: zone }))}
            onChange={(e) => set({ timezone: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

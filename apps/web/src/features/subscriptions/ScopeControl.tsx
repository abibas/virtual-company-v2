import { ChipsInput } from '../../components/forms/ChipsInput.tsx';
import { Switch } from '../../components/forms/Switch.tsx';

/** Where a right reaches: all, or the names listed (none yet: nowhere). */
export type Scope = 'all' | string[];

export interface ScopeProps {
  readonly label: string;
  /** The switch's label: "All repositories". */
  readonly all: string;
  readonly scope: Scope;
  readonly onChange: (scope: Scope) => void;
  /** What a chip may be: a pattern, or a test of its own. */
  readonly pattern: RegExp | ((entry: string) => boolean);
  readonly normalize?: (entry: string) => string;
  readonly placeholder: string;
  readonly disabled: boolean;
}

/** A scope: the All switch, else the names as chips. */
export function ScopeControl({
  label,
  all,
  scope,
  onChange,
  pattern,
  normalize,
  placeholder,
  disabled,
}: ScopeProps) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Switch
        label={all}
        checked={scope === 'all'}
        disabled={disabled}
        onChange={(on) => onChange(on ? 'all' : [])}
      />
      {scope !== 'all' && (
        <ChipsInput
          label={label}
          values={scope}
          onChange={onChange}
          valid={(entry) => (typeof pattern === 'function' ? pattern(entry) : pattern.test(entry))}
          normalize={normalize}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );
}

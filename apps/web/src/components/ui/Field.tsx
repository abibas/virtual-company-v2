import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';

const CONTROL =
  'w-full min-w-0 rounded-sm border border-line-2 bg-ground px-3 py-2 text-[14px] text-ink placeholder:text-faint disabled:opacity-60 aria-[invalid=true]:border-alarm';

interface FieldFrame {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
}

function Frame({
  label,
  hint,
  error,
  className = '',
  id,
  children,
}: FieldFrame & { readonly id: string; readonly children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-[12.5px] text-dim">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[12.5px] text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, frame: FieldFrame) =>
  [frame.hint ? `${id}-hint` : '', frame.error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

export type TextFieldProps = FieldFrame & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

/** A labelled text input with an optional hint and error, wired for screen readers. */
export function TextField({ label, hint, error, className, ...input }: TextFieldProps) {
  const id = useId();
  const frame = { label, hint, error, className };
  return (
    <Frame {...frame} id={id}>
      <input
        id={id}
        aria-describedby={describedBy(id, frame)}
        aria-invalid={error ? true : undefined}
        className={CONTROL}
        {...input}
      />
    </Frame>
  );
}

export type SelectFieldProps = FieldFrame &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
    readonly options: readonly { readonly value: string; readonly label: string }[];
  };

/** A labelled native select (keyboard and screen-reader friendly as it is). */
export function SelectField({ label, hint, error, className, options, ...select }: SelectFieldProps) {
  const id = useId();
  const frame = { label, hint, error, className };
  return (
    <Frame {...frame} id={id}>
      <select id={id} aria-describedby={describedBy(id, frame)} className={CONTROL} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Frame>
  );
}

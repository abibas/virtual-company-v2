import { type ReactNode, useId } from 'react';
import { cx } from '../cx.ts';
import { Input, type InputProps, Select, type SelectProps } from './Input.tsx';

interface FieldFrame {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
}

/** The label above, the control, then the hint and the error, wired for screen readers. */
export function Field({
  label,
  hint,
  error,
  className,
  id,
  children,
}: FieldFrame & { readonly id: string; readonly children: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-dim">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A labelled group of choices that names itself (a segmented control, a face picker, both with their own
 * `aria-label`): the same label shown above it, and the hint below.
 */
export function ChoiceField({
  label,
  hint,
  className,
  children,
}: Omit<FieldFrame, 'error'> & { readonly children: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col items-start gap-1.5', className)}>
      <p aria-hidden="true" className="text-sm font-semibold text-ink-2">
        {label}
      </p>
      {children}
      {hint && <p className="text-xs text-dim">{hint}</p>}
    </div>
  );
}

const describedBy = (id: string, frame: FieldFrame) =>
  [frame.hint ? `${id}-hint` : '', frame.error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

export type TextFieldProps = FieldFrame & Omit<InputProps, 'className'>;

/** A labelled text input with an optional hint and error. */
export function TextField({ label, hint, error, className, ...input }: TextFieldProps) {
  const id = useId();
  const frame = { label, hint, error, className };
  return (
    <Field {...frame} id={id}>
      <Input
        id={id}
        aria-describedby={describedBy(id, frame)}
        aria-invalid={error ? true : undefined}
        {...input}
      />
    </Field>
  );
}

/**
 * The attributes of a field that takes a secret (a token, an API key, a header's value): dots on screen, no
 * spelling or autocorrect, and no browser or password manager offering to save or fill it.
 */
export const SECRET_INPUT = {
  type: 'password',
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
} as const;

export type SecretFieldProps = Omit<TextFieldProps, 'type' | 'autoComplete'>;

/**
 * A labelled field for a secret that goes to the server once and never comes back: shown as dots, never kept by the
 * browser. The form clears it after saving.
 */
export function SecretField(props: SecretFieldProps) {
  return <TextField {...props} {...SECRET_INPUT} />;
}

export type SelectFieldProps = FieldFrame & Omit<SelectProps, 'className'>;

/** A labelled select. */
export function SelectField({ label, hint, error, className, ...select }: SelectFieldProps) {
  const id = useId();
  const frame = { label, hint, error, className };
  return (
    <Field {...frame} id={id}>
      <Select id={id} aria-describedby={describedBy(id, frame)} {...select} />
    </Field>
  );
}

import { useId } from 'react';
import { cx } from '../cx.ts';

/** An on/off control with its label beside it (a filter, a setting that applies at once). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const id = useId();
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-blue' : 'bg-surface-3 ring-1 ring-line-2 ring-inset',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(20,24,60,0.3)] transition-transform duration-150',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="cursor-pointer text-sm font-medium text-ink-2 select-none"
      >
        {label}
      </label>
    </span>
  );
}

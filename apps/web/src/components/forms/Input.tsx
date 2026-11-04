import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../cx.ts';

/** The look of every text control: a tinted field that turns white with a blue ring when it has focus. */
export const CONTROL =
  'h-10 w-full min-w-0 rounded-md bg-surface-2 px-3.5 text-base text-ink ring-1 ring-transparent ring-inset transition-[box-shadow,background-color] duration-150 placeholder:text-faint focus:bg-surface focus:ring-blue focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:ring-failed';

export const CONTROL_SM = 'h-8 rounded-sm px-2.5 text-sm';

export type InputProps = Omit<ComponentPropsWithRef<'input'>, 'size'> & { readonly size?: 'sm' | 'md' };

/** A bare text input in the house style; `TextField` adds the label, hint and error. */
export function Input({ className, size = 'md', ...rest }: InputProps) {
  return <input className={cx(CONTROL, size === 'sm' && CONTROL_SM, className)} {...rest} />;
}

export type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'size'> & {
  readonly size?: 'sm' | 'md';
  readonly options: readonly { readonly value: string; readonly label: string }[];
};

/** A native select (keyboard and screen-reader friendly as it is) with the house chevron. */
export function Select({ className, size = 'md', options, ...rest }: SelectProps) {
  return (
    <span className={cx('relative inline-flex w-full min-w-0', className)}>
      <select
        className={cx(CONTROL, size === 'sm' && CONTROL_SM, 'cursor-pointer appearance-none pr-9')}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-dim"
      />
    </span>
  );
}

export type TextareaProps = ComponentPropsWithRef<'textarea'>;

/** A multi-line input in the house style. */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cx(CONTROL, 'h-auto min-h-24 resize-y py-2.5', className)} {...rest} />;
}

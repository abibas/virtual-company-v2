import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { Spinner } from '../ui/Button.tsx';

/** Where a step stands: done, worked on by the app (`busy`), waiting for the person (`current`), to come, or failed. */
export type StepState = 'done' | 'busy' | 'current' | 'todo' | 'failed';

export interface Step {
  readonly key: string;
  readonly label: string;
  readonly state: StepState;
  /** What the person does or sees at this step (a button, a code, a field), shown under its label. */
  readonly detail?: ReactNode;
}

const WORDS: Readonly<Record<StepState, string>> = {
  done: 'done',
  busy: 'in progress',
  current: 'your turn',
  todo: 'next',
  failed: 'failed',
};

const MARKS: Readonly<Record<StepState, string>> = {
  done: 'bg-done text-white',
  busy: 'bg-blue-soft text-blue',
  current: 'bg-blue text-on-blue shadow-primary',
  todo: 'bg-surface-3 text-dim',
  failed: 'bg-failed text-white',
};

/** A step's round mark: a tick, a spinner, its number, or a cross. */
function StepMark({ state, n }: { readonly state: StepState; readonly n: number }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        MARKS[state],
      )}
    >
      {state === 'done' && <Check size={14} strokeWidth={3} />}
      {state === 'failed' && <X size={14} strokeWidth={3} />}
      {state === 'busy' && <Spinner size={14} />}
      {(state === 'current' || state === 'todo') && n}
    </span>
  );
}

/**
 * A short process as numbered steps that fill in as it goes (a sign-in): done ones ticked, the app's work spinning, the
 * person's turn in blue with what to do under it, a failure crossed out. Each step's state is read out with its label.
 */
export function Steps({
  steps,
  label,
  className,
}: {
  readonly steps: readonly Step[];
  /** What the steps are of, for screen readers. */
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <ol aria-label={label} className={cx('flex flex-col', className)}>
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' || step.state === 'busy' ? 'step' : undefined}
          className="relative flex gap-3 pb-5 last:pb-0"
        >
          {index < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={cx(
                'absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2',
                step.state === 'done' ? 'bg-done' : 'bg-line-2',
              )}
            />
          )}
          <StepMark state={step.state} n={index + 1} />
          <div className="min-w-0 flex-1 pt-1">
            <p
              className={cx(
                'text-sm font-semibold',
                step.state === 'todo' ? 'text-dim' : step.state === 'failed' ? 'text-failed' : 'text-ink',
              )}
            >
              {step.label}
              <span className="sr-only">, {WORDS[step.state]}</span>
            </p>
            {step.detail && <div className="mt-2.5">{step.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

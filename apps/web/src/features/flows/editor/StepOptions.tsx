import { SEND_BACK_LIMIT } from '@mwc/shared/flows';
import type { ReactNode } from 'react';
import { Input, Select } from '../../../components/forms/Input.tsx';
import { SegmentedControl } from '../../../components/forms/Segmented.tsx';
import type { DraftStep } from './draft.ts';

/** A small word and its control (which names itself), on the step's second line. */
function Option({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden="true" className="text-xs font-semibold whitespace-nowrap text-dim">
        {label}
      </span>
      {children}
    </div>
  );
}

/** The limit as typed: a whole number in range, or none when empty. */
function limitOf(text: string): number | null {
  const n = Number.parseInt(text, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(SEND_BACK_LIMIT.max, Math.max(SEND_BACK_LIMIT.min, n));
}

interface OptionsProps {
  readonly step: DraftStep;
  /** The steps before it, the send-back choices. */
  readonly earlier: readonly DraftStep[];
  /** Its send-back target when that is no longer earlier (moved below it), shown so the choice can be fixed. */
  readonly later: DraftStep | undefined;
  readonly agent: boolean;
  readonly onChange: (change: Partial<DraftStep>) => void;
}

const stepLabel = (step: DraftStep) => step.name.trim() || 'Unnamed step';

/** A Check or Sign-off step's send-back: where to (an earlier step, or nowhere) and its limit (a number, or none). */
function SendBack({ step, earlier, later, onChange }: Omit<OptionsProps, 'agent'>) {
  const name = step.name.trim() || 'Step';
  const targets = [...earlier.map((other) => ({ value: other.key, label: stepLabel(other) }))];
  if (later) targets.push({ value: later.key, label: `${stepLabel(later)} (later)` });
  return (
    <>
      <Option label="Sends back to">
        <Select
          size="sm"
          aria-label={`${name}: sends back to`}
          className="w-40!"
          value={step.sendsBackTo ?? ''}
          onChange={({ target }) =>
            onChange(target.value === '' ? { sendsBackTo: null, limit: null } : { sendsBackTo: target.value })
          }
          options={[{ value: '', label: 'Nowhere' }, ...targets]}
        />
      </Option>
      <Option label="Limit">
        <Input
          size="sm"
          aria-label={`${name}: send-back limit`}
          type="number"
          inputMode="numeric"
          min={SEND_BACK_LIMIT.min}
          max={SEND_BACK_LIMIT.max}
          placeholder="none"
          disabled={step.sendsBackTo === null}
          className="w-20!"
          value={step.limit ?? ''}
          onChange={(event) => onChange({ limit: limitOf(event.target.value) })}
        />
      </Option>
    </>
  );
}

/**
 * A step's options, its second line: Starts (Auto or On Start), Comes back again (Keep or Fresh; an agent's step, since
 * people keep no conversation), and for a Check or Sign-off step where it sends back to (an earlier step) and its limit.
 */
export function StepOptions(props: OptionsProps) {
  const { step, agent, onChange } = props;
  const name = step.name.trim() || 'Step';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Option label="Starts">
        <SegmentedControl
          label={`${name}: starts`}
          size="sm"
          value={step.starts}
          onChange={(starts) => onChange({ starts })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'manual', label: 'On Start' },
          ]}
        />
      </Option>
      {agent && (
        <Option label="Comes back">
          <SegmentedControl
            label={`${name}: when the same task comes back`}
            size="sm"
            value={step.onReturn}
            onChange={(onReturn) => onChange({ onReturn })}
            options={[
              { value: 'keep', label: '↻ Keep' },
              { value: 'fresh', label: '✦ Fresh' },
            ]}
          />
        </Option>
      )}
      {step.kind !== 'work' && <SendBack {...props} />}
    </div>
  );
}

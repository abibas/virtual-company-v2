import type { ChatDelivery } from '../../../api/types.ts';
import { SegmentedControl } from '../../../components/forms/Segmented.tsx';
import type { DeliveryChoice } from './delivery.ts';

/**
 * The strip above the message box while the agent works (S5.2 step 6): how the next message reaches it, Now, After
 * this turn or Interrupt, with what the chosen one does in a few words.
 */
export function DeliveryStrip({
  choices,
  value,
  onChange,
}: {
  readonly choices: readonly DeliveryChoice[];
  readonly value: ChatDelivery;
  readonly onChange: (delivery: ChatDelivery) => void;
}) {
  const chosen = choices.find((choice) => choice.value === value);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <span aria-hidden="true" className="relative inline-flex size-1.5">
          <span className="absolute inset-0 rounded-full bg-blue motion-safe:animate-ping" />
          <span className="relative size-1.5 rounded-full bg-blue" />
        </span>
        The agent is working — send:
      </span>
      <SegmentedControl
        options={choices.map(({ value: v, label }) => ({ value: v, label }))}
        value={value}
        onChange={onChange}
        label="How the message reaches the agent"
        size="sm"
      />
      {chosen && <span className="min-w-0 text-2xs text-dim">{chosen.hint}</span>}
    </div>
  );
}

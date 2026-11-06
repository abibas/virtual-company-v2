import { Bell, PanelRightOpen, Plus } from 'lucide-react';
import { IconButton } from '../ui/IconButton.tsx';

/**
 * The right rail collapsed: a slim strip at the right edge with the way back (expand), what needs the person (its
 * count in a dot that pulses while something waits) and, at the foot, a "+" that opens the rail on Quick create.
 */
export function RailStrip({
  count,
  onExpand,
  onCompose,
}: {
  readonly count: number;
  readonly onExpand: () => void;
  /** Opens the rail with the quick-create composer focused. */
  readonly onCompose: () => void;
}) {
  return (
    // A card without its clipping, so the tooltips and the pulse can reach past the strip.
    <div className="ml-auto flex h-full w-13 flex-col items-center gap-2 rounded-2xl bg-surface py-3 shadow-card">
      <IconButton
        label="Expand the right rail"
        icon={PanelRightOpen}
        // Level with the top bar: a label to the left would sit on the user's name, so it hangs below.
        tooltip="bottom-end"
        aria-expanded={false}
        data-rail-toggle
        onClick={onExpand}
      />
      <span aria-hidden="true" className="h-px w-6 bg-line" />
      <IconButton
        label={count > 0 ? `Attention required: ${count}` : 'Attention required'}
        icon={Bell}
        tooltip="left"
        badge={count}
        pulse
        onClick={onExpand}
      />
      <div className="mt-auto">
        <IconButton
          label="Quick create task"
          icon={Plus}
          tone="soft"
          round
          tooltip="left"
          onClick={onCompose}
        />
      </div>
    </div>
  );
}

import { Shrink } from 'lucide-react';
import { useId } from 'react';
import { cx } from '../../../components/cx.ts';
import { useFloatingPanel } from '../../../components/forms/floating.ts';
import { ContextDetails } from './ContextDetails.tsx';
import { TONE_FILL } from './ContextFills.tsx';
import { ConversationActions, type ConversationControls, GatedButton } from './ConversationActions.tsx';
import type { ConversationView } from './context-state.ts';
import { type Fullness, fullness, meterLine } from './context-text.ts';
import { usePopover } from './use-popover.ts';

/** The words of the meter's line: quiet with room, amber filling up, red and bolder near full. */
const LINE: Readonly<Record<Fullness, string>> = {
  room: 'text-dim',
  filling: 'text-input',
  full: 'font-semibold text-failed',
};

/** The meter's pill: quiet until hovered or open; the button inside takes the focus, the pill shows its ring. */
const PILL =
  'relative flex min-w-0 items-center gap-2.5 rounded-full px-2 py-1 hover:bg-surface-2 has-[[aria-expanded=true]]:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue';

/** The thin bar in the trigger: a quiet track and the used share, in the meter's tone. */
function ThinBar({ percent, tone }: { readonly percent: number; readonly tone: Fullness }) {
  return (
    <span className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-3">
      <span
        className={cx(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 motion-reduce:transition-none',
          TONE_FILL[tone],
        )}
        style={{ width: `${Math.min(100, percent)}%`, minWidth: percent > 0 ? '0.25rem' : 0 }}
      />
    </span>
  );
}

/** Near full: a soft halo around a dot, the one moving thing (motion-safe only). */
function FullDot() {
  return (
    <span aria-hidden="true" className="relative inline-flex size-1.5 shrink-0">
      <span className="absolute inset-0 rounded-full bg-failed motion-safe:animate-attention" />
      <span className="relative size-1.5 rounded-full bg-failed" />
    </span>
  );
}

/**
 * The chat's context meter by the composer (S5.2): a thin bar and "Context 476k / 1M · 48%", green, amber past 70% and
 * red past 90%, with Compact beside it once past 70%. A click (or Enter) opens a popover with what fills the window,
 * the last turn, the conversation so far, and Compact and Clear; it holds the focus and closes on Escape.
 */
export function ContextMeter({
  view,
  controls,
}: {
  readonly view: ConversationView;
  readonly controls: ConversationControls;
}) {
  const popover = usePopover();
  const id = useId();
  const place = useFloatingPanel(popover.open, 'end', popover.trigger, popover.panel, popover.close);
  const tone = fullness(view.percent);
  const line = meterLine(view.used, view.window, view.percent, view.estimate);
  const inlineCompact = controls.canCompact && tone !== 'room';
  return (
    <div ref={popover.root} className="flex min-w-0 items-center gap-1.5">
      {inlineCompact && (
        <GatedButton
          size="sm"
          tone="soft"
          icon={Shrink}
          blocked={controls.compactBlocked}
          busy={controls.busy === 'compact'}
          onClick={controls.compact}
          className="h-7"
        >
          Compact
        </GatedButton>
      )}
      {/* The whole pill opens the popover (the button's ::after covers it); the bar stays a meter for screen readers. */}
      <div className={PILL}>
        {view.percent !== undefined && (
          // biome-ignore lint/a11y/useSemanticElements: the native <meter> cannot be styled alike in every browser.
          <span
            role="meter"
            aria-label="Context used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, view.percent)}
            aria-valuetext={line.replace(/^Context /, '')}
            className="inline-flex"
          >
            <ThinBar percent={view.percent} tone={tone} />
          </span>
        )}
        {tone === 'full' && <FullDot />}
        <button
          ref={popover.trigger}
          type="button"
          aria-expanded={popover.open}
          aria-haspopup="dialog"
          aria-controls={id}
          onClick={() => popover.setOpen((was) => !was)}
          className={cx(
            'tabular min-w-0 cursor-pointer truncate text-xs after:absolute after:inset-0 after:rounded-full focus-visible:outline-none',
            LINE[tone],
          )}
        >
          {line}
        </button>
      </div>
      <div
        ref={popover.panel}
        id={id}
        role="dialog"
        aria-label="The conversation's context"
        tabIndex={-1}
        hidden={!popover.open}
        onKeyDown={popover.trap}
        style={place}
        className="scroll-quiet z-40 max-h-[calc(100dvh-2rem)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-surface p-4 shadow-float ring-1 ring-line outline-none"
      >
        {popover.open && (
          <div className="grid gap-3">
            <ContextDetails view={view} />
            <ConversationActions controls={controls} />
          </div>
        )}
      </div>
    </div>
  );
}

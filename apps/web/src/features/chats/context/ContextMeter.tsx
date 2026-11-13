import { Shrink } from 'lucide-react';
import { useId } from 'react';
import { cx } from '../../../components/cx.ts';
import { useFloatingPanel } from '../../../components/forms/floating.ts';
import { ContextDetails } from './ContextDetails.tsx';
import { ConversationActions, type ConversationControls, GatedButton } from './ConversationActions.tsx';
import type { ConversationView } from './context-state.ts';
import { type Fullness, fullness, meterLine, meterWord } from './context-text.ts';
import { usePopover } from './use-popover.ts';

/** The meter's word: quiet with room, amber filling up, red and bolder near full. */
const WORD: Readonly<Record<Fullness, string>> = {
  room: 'text-dim',
  filling: 'text-input',
  full: 'font-semibold text-failed',
};

/** The ring's used arc, in the meter's tone: green with room, amber filling up, red near full. */
const ARC: Readonly<Record<Fullness, string>> = {
  room: 'stroke-done',
  filling: 'stroke-input',
  full: 'stroke-failed',
};

/** The meter's pill: quiet until hovered or open; the button inside takes the focus, the pill shows its ring. */
const PILL =
  'relative flex h-8 shrink-0 items-center gap-1.5 rounded-full px-1.5 hover:bg-surface-2 has-[[aria-expanded=true]]:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-blue';

/** The ring's radius in its 20-unit box, and its stroke. */
const R = 7.25;
const STROKE = 2.75;

/** A 20 px donut: a quiet track and the used share in the meter's tone (a sliver at least, once anything is used). */
function Ring({ percent, tone }: { readonly percent: number | undefined; readonly tone: Fullness }) {
  const share = percent === undefined ? 0 : Math.min(100, percent);
  const arc = share > 0 ? Math.max(share, 3) : 0;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0 -rotate-90">
      <circle cx="10" cy="10" r={R} fill="none" strokeWidth={STROKE} className="stroke-surface-3" />
      {arc > 0 && (
        <circle
          cx="10"
          cy="10"
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${arc} 100`}
          className={cx(
            'transition-[stroke-dasharray] duration-500 motion-reduce:transition-none',
            ARC[tone],
          )}
        />
      )}
    </svg>
  );
}

/**
 * The chat's context meter by the composer (S5.2; a ring since 2026-11-13): a small donut, green, amber past 70% and red
 * past 90%, with "48%" beside it when the composer has room (from 28rem; its card is the `composer` container) and
 * "Context 476k / 1M · 48% used" in its tooltip, and Compact beside it once past 70% (its word from 28rem too). A click
 * (or Enter) opens a popover with what fills the window, the last turn, the conversation so far, and Compact and Clear;
 * it holds the focus and closes on Escape.
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
          aria-label="Compact the conversation"
          className="h-7 px-2 @md/composer:px-3"
        >
          <span className="hidden @md/composer:inline">Compact</span>
        </GatedButton>
      )}
      {/* The whole pill opens the popover (the button's ::after covers it); the ring stays a meter for screen readers. */}
      <div className={PILL}>
        {view.percent === undefined ? (
          <Ring percent={undefined} tone={tone} />
        ) : (
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
            <Ring percent={view.percent} tone={tone} />
          </span>
        )}
        <button
          ref={popover.trigger}
          type="button"
          aria-label={line}
          title={line}
          aria-expanded={popover.open}
          aria-haspopup="dialog"
          aria-controls={id}
          onClick={() => popover.setOpen((was) => !was)}
          className={cx(
            'tabular cursor-pointer text-xs font-medium after:absolute after:inset-0 after:rounded-full focus-visible:outline-none',
            WORD[tone],
          )}
        >
          <span className="hidden pr-0.5 @md/composer:inline">{meterWord(view.used, view.percent, view.estimate)}</span>
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

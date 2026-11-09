import { Eraser, Info, Shrink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../../../components/cx.ts';
import { Button, type ButtonProps } from '../../../components/ui/Button.tsx';
import { Tooltip } from '../../../components/ui/Tooltip.tsx';

const CLEAR_QUESTION =
  "Start a fresh conversation? The agent forgets this chat's context; the messages stay here.";

/** What Compact and Clear can do now: each one's reason it can't (undefined: it can), and the action under way. */
export interface ConversationControls {
  /** Codex compacts by itself: no Compact. */
  readonly canCompact: boolean;
  readonly compactBlocked: string | undefined;
  readonly clearBlocked: string | undefined;
  readonly busy: 'compact' | 'clear' | undefined;
  readonly error: string | undefined;
  readonly compact: () => void;
  /** Resolves true once the Clear went through. */
  readonly clear: () => Promise<boolean>;
}

/**
 * A button that stays focusable while it can't act (`aria-disabled`), so its reason can be read and hovered; a click
 * then does nothing.
 */
export function GatedButton({
  blocked,
  onClick,
  className,
  ...rest
}: ButtonProps & { readonly blocked: string | undefined }) {
  return (
    <Button
      {...rest}
      aria-disabled={blocked !== undefined || undefined}
      title={blocked}
      onClick={blocked === undefined ? onClick : undefined}
      className={cx(
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:active:scale-100',
        className,
      )}
    />
  );
}

/** Clear, asked first: the question with Cancel (focused) and Clear; Cancel brings the buttons back. */
function ClearConfirm({
  controls,
  onDone,
}: {
  readonly controls: ConversationControls;
  readonly onDone: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="grid gap-2.5 rounded-lg bg-input-soft p-3">
      <p className="text-sm font-medium text-ink">{CLEAR_QUESTION}</p>
      <div className="flex justify-end gap-2">
        <Button ref={cancel} size="sm" disabled={controls.busy === 'clear'} onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          tone="primary"
          icon={Eraser}
          busy={controls.busy === 'clear'}
          onClick={() => void controls.clear().then((cleared) => cleared && onDone())}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

/** The reasons the actions can't run now, once each. */
function reasonsOf(controls: ConversationControls): readonly string[] {
  const reasons = [controls.canCompact ? controls.compactBlocked : undefined, controls.clearBlocked];
  return [...new Set(reasons.filter((reason): reason is string => reason !== undefined))];
}

/**
 * The popover's actions: Compact (Claude chats; for Codex a note that it compacts by itself) and Clear, asked first.
 * A blocked action stays visible, greyed, with its reason underneath; a refusal shows in plain words.
 */
export function ConversationActions({ controls }: { readonly controls: ConversationControls }) {
  const [confirming, setConfirming] = useState(false);
  const clearButton = useRef<HTMLButtonElement>(null);
  const done = () => {
    setConfirming(false);
    requestAnimationFrame(() => clearButton.current?.focus());
  };
  return (
    <div className="grid gap-2 border-t border-line pt-3">
      {confirming ? (
        <ClearConfirm controls={controls} onDone={done} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {controls.canCompact ? (
            <GatedButton
              size="sm"
              tone="secondary"
              icon={Shrink}
              blocked={controls.compactBlocked}
              busy={controls.busy === 'compact'}
              onClick={controls.compact}
            >
              Compact
            </GatedButton>
          ) : (
            <Tooltip label="Codex compacts by itself" wrap>
              <span
                // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the tooltip shows from the keyboard too.
                tabIndex={0}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-dim"
              >
                <Info size={14} aria-hidden="true" />
                No Compact needed
                <span className="sr-only">: Codex compacts by itself</span>
              </span>
            </Tooltip>
          )}
          <GatedButton
            ref={clearButton}
            size="sm"
            tone="quiet"
            icon={Eraser}
            blocked={controls.clearBlocked}
            onClick={() => setConfirming(true)}
          >
            Clear
          </GatedButton>
        </div>
      )}
      {!confirming &&
        reasonsOf(controls).map((reason) => (
          <p key={reason} className="text-xs text-dim">
            {reason}
          </p>
        ))}
      {controls.error && <p className="text-xs font-medium text-failed">{controls.error}</p>}
      {controls.canCompact && !confirming && (
        <p className="text-xs text-faint">
          Compact summarises the conversation so it takes less room; Clear starts a new one.
        </p>
      )}
    </div>
  );
}

import { SendHorizontal } from 'lucide-react';
import { KbdHint } from '../../../../components/forms/KbdHint.tsx';
import { Button } from '../../../../components/ui/Button.tsx';

/**
 * The question card's last row (S5.2 step 4): on the left how to answer (one pick or several, the number keys) or why
 * the person cannot (yet); on the right Skip and Next, or "Send answer" on the last page.
 */

/** Where the form stands, for its buttons. */
export interface ActionState {
  readonly multiSelect: boolean;
  /** How many options the number keys reach (1–9). */
  readonly keys: number;
  readonly last: boolean;
  /** The current question has a pick or words. */
  readonly answered: boolean;
  /** At least one question has: the answer can go. */
  readonly ready: boolean;
  readonly busy: boolean;
  /** Why the person cannot answer here; the buttons are hidden then. */
  readonly disabled: string | undefined;
  /** Why it cannot be sent yet. */
  readonly waiting: string | undefined;
}

function Hint({ state }: { readonly state: ActionState }) {
  const why = state.disabled ?? state.waiting;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-2xs text-dim">
      {why ?? (
        <>
          {state.multiSelect ? 'Pick any' : 'Pick one'}
          {state.keys > 0 && <KbdHint keys={state.keys === 1 ? ['1'] : [`1–${state.keys}`]} />}
          <span>or write your own</span>
        </>
      )}
    </p>
  );
}

export function QuestionActions({
  state,
  onSkip,
  onNext,
  onSend,
}: {
  readonly state: ActionState;
  readonly onSkip: () => void;
  readonly onNext: () => void;
  readonly onSend: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <Hint state={state} />
      {state.disabled === undefined && (
        <div className="flex items-center gap-1.5">
          {state.last ? (
            <Button
              size="sm"
              tone="primary"
              icon={SendHorizontal}
              busy={state.busy}
              disabled={!state.ready || state.waiting !== undefined}
              onClick={onSend}
            >
              Send answer
            </Button>
          ) : (
            <>
              <Button size="sm" tone="quiet" disabled={state.busy} onClick={onSkip}>
                Skip
              </Button>
              <Button
                size="sm"
                tone={state.answered ? 'primary' : 'secondary'}
                disabled={state.busy}
                onClick={onNext}
              >
                Next
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

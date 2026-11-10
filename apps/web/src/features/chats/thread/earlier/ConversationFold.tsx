import { ChevronRight, History } from 'lucide-react';
import { useId, useState } from 'react';
import type { ChatConversation } from '../../../../api/types.ts';
import type { EarlierTurns } from '../../../../api/use-chat-earlier.ts';
import { count, formatDate, formatDateTime, formatTime } from '../../../../components/data/format.ts';
import { Spinner } from '../../../../components/ui/Button.tsx';
import { TurnView } from '../TurnView.tsx';

/**
 * One conversation before a Clear, folded into a quiet bar above the current one: "Earlier conversation · 12 messages ·
 * 21:02–23:38", cleared at its time. Opening it loads its turns once (kept) and shows them in place, softer; opening
 * again folds them.
 */

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "21:02–23:38", with the date first when it was not today. */
function spanText(from: string | null, to: string | null): string | undefined {
  if (from === null || to === null) return undefined;
  const day = sameDay(new Date(from), new Date()) ? '' : `${formatDate(from)}, `;
  const start = formatTime(from);
  const end = formatTime(to);
  return start === end ? `${day}${start}` : `${day}${start}–${end}`;
}

function Turns({ turns, agentName }: { readonly turns: EarlierTurns; readonly agentName: string }) {
  if (turns.status === 'loading') return null;
  if (turns.status === 'failed') {
    return (
      <p role="alert" className="px-3 py-2 text-2xs text-failed">
        This conversation didn't load. Open it again to retry.
      </p>
    );
  }
  return (
    <ol className="grid gap-7 opacity-75 saturate-50 transition-opacity hover:opacity-100 hover:saturate-100 motion-reduce:transition-none">
      {turns.turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          agentName={agentName}
          chatInit={undefined}
          place={{ last: false, answer: false, answering: undefined }}
        />
      ))}
    </ol>
  );
}

export function ConversationFold({
  conversation,
  turns,
  onLoad,
  agentName,
}: {
  readonly conversation: ChatConversation;
  readonly turns: EarlierTurns | undefined;
  /** Loads its turns (once; a failed load again). */
  readonly onLoad: () => void;
  readonly agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const span = spanText(conversation.from, conversation.to);
  const loading = open && turns?.status === 'loading';
  const toggle = () => {
    if (!open) onLoad();
    setOpen(!open);
  };
  return (
    <li className={open ? 'grid gap-5 pb-5' : 'grid'}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        aria-busy={loading || undefined}
        onClick={toggle}
        title={`Cleared ${formatDateTime(conversation.clearedAt)}`}
        className="group flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg bg-surface-2/60 px-3 py-2 text-left text-xs text-dim ring-1 ring-line ring-inset transition-colors hover:bg-surface-2 hover:text-ink-2 aria-expanded:bg-surface-2"
      >
        <History size={14} aria-hidden="true" className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-ink-2">Earlier conversation</span>
          {' · '}
          <span className="tabular">{count(conversation.turns, 'message')}</span>
          {span && <span className="tabular"> · {span}</span>}
        </span>
        <span className="hidden shrink-0 text-faint tabular sm:inline">
          cleared {formatTime(conversation.clearedAt)}
        </span>
        {loading ? (
          <Spinner size={13} className="text-blue" />
        ) : (
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="shrink-0 text-faint transition-transform duration-200 group-aria-expanded:rotate-90 motion-reduce:transition-none"
          />
        )}
      </button>
      <div id={panel} hidden={!open}>
        {open && turns && <Turns turns={turns} agentName={agentName} />}
      </div>
    </li>
  );
}

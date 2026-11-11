import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import type { TaskEvent } from '../../../api/flows.ts';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { ago, formatDateTime } from '../../../components/data/format.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Markdown } from '../../chats/thread/markdown/Markdown.tsx';
import { useArtifactText } from '../artifacts/ArtifactViewer.tsx';
import { LiveDot } from '../conversations/LiveDot.tsx';
import { Face } from '../Face.tsx';
import { KIND } from '../words.ts';
import { Clip } from './Clip.tsx';
import { FileChips } from './FileChips.tsx';
import { asideWords, OUTCOME } from './outcomes.ts';
import { plainExcerpt, type StoryStep } from './story.ts';

type Load = (artifact: TaskArtifact) => Promise<Blob>;

/** When, as "3 h ago" with the date and time on hover. */
export const When = ({ at, className }: { readonly at: string; readonly className?: string }) => (
  <time
    dateTime={at}
    title={formatDateTime(at)}
    className={cx('shrink-0 text-2xs text-faint tabular', className)}
  >
    {ago(at)}
  </time>
);

/** The hand-off note: two plain lines that open in place to the whole note, rendered. */
function Note({
  note,
  load,
  open,
  onToggle,
  teaser,
}: {
  readonly note: TaskArtifact;
  readonly load: Load;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Show its first lines while closed (no reason took that place). */
  readonly teaser: boolean;
}) {
  const text = useArtifactText(note, load);
  if (open) {
    return (
      <div className="grid gap-1 rounded-lg bg-surface-2 px-3 py-2">
        {text.data === undefined ? (
          <span className="text-xs text-faint">{text.error ? 'Could not be read' : '…'}</span>
        ) : (
          <Markdown text={text.data} className="text-sm" />
        )}
        <button
          type="button"
          onClick={onToggle}
          className="justify-self-start text-2xs font-semibold text-blue hover:underline"
        >
          less
        </button>
      </div>
    );
  }
  if (!teaser) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Show the whole hand-off note"
      className="line-clamp-2 cursor-pointer text-left text-xs leading-relaxed text-ink-2 hover:text-ink"
    >
      {text.data === undefined ? (text.error ? 'Could not be read' : '…') : plainExcerpt(text.data)}
    </button>
  );
}

/** A person's action or an error while the task was at the step: one small line, its reason clipped. */
export function StoryAside({ event }: { readonly event: TaskEvent }) {
  const error = event.kind === 'blocked' || event.kind === 'turn_ended';
  return (
    <li className="flex min-w-0 items-baseline gap-1.5 text-2xs">
      <span className={cx('shrink-0 font-semibold', error ? 'text-failed' : 'text-dim')}>
        {asideWords(event)}
      </span>
      {event.reason && <Clip text={event.reason} className="flex-1 text-ink-2" />}
      <When at={event.at} className="ml-auto" />
    </li>
  );
}

/**
 * One step of a round: its kind's dot, the agent's face, the step, what came of it (and where it went back to), when;
 * the reason once, else the hand-off note's first lines (both open in place); people's actions and errors as small
 * lines; its files as chips; its conversation.
 */
export function StoryStepRow({
  step,
  nodes,
  load,
  onOpenFile,
  onConversation,
  me,
}: {
  readonly step: StoryStep;
  /** The viewer's principal: a step waiting for them says "Needs you". */
  readonly me: string | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly load: Load;
  readonly onOpenFile: (artifact: TaskArtifact) => void;
  readonly onConversation: (chatId: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const look = OUTCOME[step.outcome];
  const kind = step.kind ? KIND[step.kind] : undefined;
  const by = step.by && step.by.principalId !== step.assignee?.principalId ? step.by : undefined;
  const toward =
    step.to && (step.outcome === 'sent_back' || step.outcome === 'routed') ? ` → ${step.to}` : '';
  const asides = step.arrival ? [step.arrival, ...step.asides] : step.asides;
  const { conversation, note } = step;
  return (
    <li className="relative grid gap-1 py-2 pl-6">
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-[15px] left-[3px] size-2.5 rounded-full ring-2 ring-surface',
          kind?.solid ?? 'bg-faint',
        )}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {step.assignee && <Face who={step.assignee} nodes={nodes} />}
        <span className="text-sm font-semibold text-ink" title={kind?.label}>
          {step.step.name}
        </span>
        <Badge tone={look.tone} size="sm">
          {step.outcome === 'working' && <LiveDot live className="bg-blue" />}
          {step.outcome === 'needs_person' && me && step.assignee?.principalId === me
            ? 'Needs you'
            : look.label}
          {toward}
        </Badge>
        {by && <span className="text-2xs text-dim">by {by.name}</span>}
        {step.startedBy && (
          <span className="text-2xs text-dim max-sm:hidden">started by {step.startedBy.name}</span>
        )}
        <span className="ml-auto flex items-center gap-2.5">
          {note && !noteOpen && step.reason && (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="text-2xs font-semibold text-blue hover:underline"
            >
              note
            </button>
          )}
          {conversation && (
            <button
              type="button"
              onClick={() => onConversation(conversation.chatId)}
              title="Open this step's conversation"
              className="inline-flex items-center gap-1 text-2xs font-semibold text-dim hover:text-blue"
            >
              <MessagesSquare size={12} aria-hidden="true" />
              <span className="max-sm:sr-only">conversation</span>
            </button>
          )}
          <When at={step.endedAt ?? step.at} />
        </span>
      </div>
      {step.reason && <Clip text={step.reason} lines={2} className="text-xs leading-relaxed text-ink-2" />}
      {note && (
        <Note
          note={note}
          load={load}
          open={noteOpen}
          onToggle={() => setNoteOpen(!noteOpen)}
          teaser={!step.reason}
        />
      )}
      {asides.length > 0 && (
        <ul className="grid gap-0.5">
          {asides.map((event) => (
            <StoryAside key={event.id} event={event} />
          ))}
        </ul>
      )}
      <FileChips files={step.files} load={load} onOpen={onOpenFile} />
    </li>
  );
}

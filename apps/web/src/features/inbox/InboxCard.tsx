import { TASK_REASON_MAX } from '@mwc/shared/flows';
import { ArrowRight, CornerUpLeft, Stamp } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { InboxItem } from '../../api/inbox.ts';
import { Link } from '../../app/router.tsx';
import { ago, formatDateTime } from '../../components/data/format.ts';
import { Textarea } from '../../components/forms/Input.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { PRIORITY } from '../flows/words.ts';
import { type InboxAnswer, InboxQuestion } from './InboxQuestion.tsx';
import { INBOX_KIND } from './kinds.ts';

/** A Sign-off's move from the inbox: approve it, or send it back with the reason. */
export type InboxMove =
  | { readonly action: 'approve' }
  | { readonly action: 'send_back'; readonly reason: string };

/** Who is named beside the item: who handed it on, who escalated it, the step's agent; a question names its agent above. */
function whoOf(item: InboxItem): string | undefined {
  if (item.from === null || item.kind === 'question') return undefined;
  if (item.kind === 'signoff' || item.kind === 'step') return `from ${item.from.name}`;
  if (item.kind === 'escalated') return `by ${item.from.name}`;
  return item.from.name;
}

/** The kind's chip, the task's key and priority, the company when it is another one, and how long it has waited. */
function CardHead({ item, company }: { readonly item: InboxItem; readonly company: boolean }) {
  const kind = INBOX_KIND[item.kind];
  const priority = item.task?.priority;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-2xs">
      <Badge tone={kind.tone} size="sm" icon={kind.icon}>
        {kind.word}
      </Badge>
      {item.task && <span className="font-mono font-bold text-dim">{item.task.key}</span>}
      {priority && priority !== 'normal' && (
        <Badge tone={PRIORITY[priority].tone} size="sm">
          {PRIORITY[priority].label}
        </Badge>
      )}
      {company && <span className="min-w-0 truncate font-semibold text-dim">{item.company.name}</span>}
      <time dateTime={item.at} title={formatDateTime(item.at)} className="ml-auto shrink-0 text-faint">
        {ago(item.at)}
      </time>
    </span>
  );
}

/** Send back's reason (required) and its two buttons, under the card's own. */
function SendBack({
  busy,
  onSend,
  onCancel,
}: {
  readonly busy: boolean;
  readonly onSend: (reason: string) => void;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const why = reason.trim();
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Why it goes back"
        placeholder="What should be fixed"
        rows={2}
        maxLength={TASK_REASON_MAX}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="min-h-16 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" tone="quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" icon={CornerUpLeft} busy={busy} disabled={why === ''} onClick={() => onSend(why)}>
          Send back
        </Button>
      </div>
    </div>
  );
}

/** Where it is and who moved it, with Open unless the card decides in place. */
function CardMeta({
  item,
  href,
  open,
}: {
  readonly item: InboxItem;
  readonly href: string;
  readonly open: boolean;
}) {
  const who = whoOf(item);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <p
        className="min-w-0 flex-1 truncate text-xs text-dim"
        title={who ? `${item.subtitle} · ${who}` : item.subtitle}
      >
        {item.subtitle}
        {who && <span className="text-faint"> · {who}</span>}
      </p>
      {open && (
        <Link
          to={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-blue hover:underline"
        >
          Open
          <ArrowRight size={13} strokeWidth={2.5} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** A Sign-off's two moves in place: Approve, and Send back… (its reason under the card's lines). */
function SignOff({
  sendsBack,
  act,
}: {
  readonly sendsBack: boolean;
  readonly act: { readonly busy: InboxMove['action'] | undefined; send(move: InboxMove): void };
}) {
  const [sending, setSending] = useState(false);
  if (sending)
    return (
      <SendBack
        busy={act.busy === 'send_back'}
        onCancel={() => setSending(false)}
        onSend={(reason) => act.send({ action: 'send_back', reason })}
      />
    );
  return (
    <div className="mt-0.5 flex flex-wrap gap-2">
      <Button
        size="sm"
        tone="primary"
        icon={Stamp}
        busy={act.busy === 'approve'}
        disabled={act.busy !== undefined}
        onClick={() => act.send({ action: 'approve' })}
      >
        Approve
      </Button>
      {sendsBack && (
        <Button
          size="sm"
          icon={CornerUpLeft}
          disabled={act.busy !== undefined}
          onClick={() => setSending(true)}
        >
          Send back…
        </Button>
      )}
    </div>
  );
}

/** A move from the card in flight: which one is busy, the refusal's words, and the send. */
function useCardMove(item: InboxItem, onAct: (item: InboxItem, move: InboxMove) => Promise<void>) {
  const [busy, setBusy] = useState<InboxMove['action']>();
  const [error, setError] = useState<string>();
  const send = (move: InboxMove) => {
    setBusy(move.action);
    setError(undefined);
    onAct(item, move)
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(undefined));
  };
  return { busy, error, send };
}

/**
 * One item of the inbox, compact: its chip, key and age; its title (the task's, or the agent's question), which opens
 * it; where it is and who moved it, with Open; why it waits. A Sign-off the person may decide gets Approve and Send
 * back… in place (`onAct`, the task's actions route) instead of Open; an agent's question gets its options and Send
 * in place (`onAnswer`, the chat's answers route, S6c), Open still beside it. A refusal shows its own words under the
 * buttons.
 */
export function InboxCard({
  item,
  href,
  company,
  onAct,
  onAnswer,
}: {
  readonly item: InboxItem;
  readonly href: string;
  /** The item is in another company than the page's: its name shows. */
  readonly company: boolean;
  readonly onAct: (item: InboxItem, move: InboxMove) => Promise<void>;
  /** Answers an agent's question in place (S6c); none: Open goes to the chat's card. */
  readonly onAnswer?: InboxAnswer | undefined;
}) {
  const move = useCardMove(item, onAct);
  const decides = item.kind === 'signoff' && item.actions.includes('approve');
  const answers = item.kind === 'question' && item.actions.includes('answer') && onAnswer !== undefined;
  return (
    <article className="flex flex-col gap-1.5 rounded-xl bg-surface p-2.5 shadow-card ring-1 ring-line">
      <CardHead item={item} company={company} />
      <Link
        to={href}
        className="line-clamp-2 text-sm leading-snug font-semibold text-ink hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {item.title}
      </Link>
      <CardMeta item={item} href={href} open={!decides} />
      {item.reason && <p className="line-clamp-2 text-xs text-ink-2">{item.reason}</p>}
      {decides && <SignOff sendsBack={item.actions.includes('send_back')} act={move} />}
      {answers && <InboxQuestion item={item} onAnswer={onAnswer} />}
      {move.error && (
        <p role="alert" className="text-xs text-failed">
          {move.error}
        </p>
      )}
    </article>
  );
}

import { CircleAlert, CircleCheck, CircleX, TriangleAlert, Wrench } from 'lucide-react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { formatTime } from '../../../components/data/format.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Spinner } from '../../../components/ui/Button.tsx';
import { TURN_STATUS, tokens, turnErrorText } from '../chat-text.ts';
import { RichText } from './RichText.tsx';
import { type Reply, type ReplyPart, replyOf } from './reply-parts.ts';

/** One turn of a chat (S5.1c): the person's prompt, then the agent's reply as its events build it, with its status. */

/** A tool call in one line, "Ran: <summary>", that opens to the start of its result. */
function ToolLine({ part }: { readonly part: Extract<ReplyPart, { kind: 'tool' }> }) {
  const failed = part.result?.ok === false;
  const Mark = part.result === undefined ? Wrench : failed ? CircleX : CircleCheck;
  return (
    <details className="group min-w-0 rounded-lg bg-surface-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-ink-2 hover:text-ink">
        <Mark
          size={13}
          aria-hidden="true"
          className={
            failed ? 'shrink-0 text-failed' : part.result ? 'shrink-0 text-done' : 'shrink-0 text-dim'
          }
        />
        <span className="shrink-0 font-semibold">Ran {part.name}:</span>
        <span className="min-w-0 truncate font-mono text-dim">{part.summary}</span>
        {part.result === undefined && <Spinner size={12} className="ml-auto text-dim" />}
      </summary>
      <pre className="scroll-quiet max-h-64 overflow-auto border-t border-line px-2.5 py-2 font-mono text-2xs leading-normal break-words whitespace-pre-wrap text-ink-2">
        {part.result ? part.result.summary || '(no output)' : 'Still running…'}
      </pre>
    </details>
  );
}

function Part({ part }: { readonly part: ReplyPart }) {
  if (part.kind === 'text') return <RichText text={part.text} />;
  if (part.kind === 'tool') return <ToolLine part={part} />;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${part.level === 'warn' ? 'text-input' : 'text-dim'}`}>
      <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{part.message}</span>
    </p>
  );
}

/** The quiet footer: tokens in and out (cached ones), and the cost when the harness gives it. */
function UsageLine({ usage }: { readonly usage: NonNullable<Reply['usage']> }) {
  const cached = usage.cachedInputTokens ? ` (${tokens(usage.cachedInputTokens)} cached)` : '';
  const cost = usage.costUsd === undefined ? '' : ` · $${usage.costUsd.toFixed(usage.costUsd < 1 ? 3 : 2)}`;
  return (
    <p className="text-2xs text-faint">
      {tokens(usage.inputTokens)} in{cached} · {tokens(usage.outputTokens)} out{cost}
    </p>
  );
}

/** The turn's status chip: a spinner while it runs. */
function StatusChip({ turn }: { readonly turn: ChatTurnWithEvents }) {
  const { tone, text } = TURN_STATUS[turn.status];
  return (
    <Badge tone={tone} size="sm" dot={turn.status !== 'running'}>
      {turn.status === 'running' && <Spinner size={10} />}
      {text}
    </Badge>
  );
}

/** The agent's side of a turn: its parts, its error, its usage. */
function ReplyBody({ turn, reply }: { readonly turn: ChatTurnWithEvents; readonly reply: Reply }) {
  const waiting = reply.parts.length === 0 && reply.error === undefined;
  return (
    <div className="grid min-w-0 gap-2">
      {reply.parts.map((part) => (
        <Part key={part.key} part={part} />
      ))}
      {waiting && turn.status === 'running' && <p className="text-sm text-dim">Working…</p>}
      {waiting && turn.status === 'queued' && <p className="text-sm text-dim">Waiting for the machine…</p>}
      {reply.error !== undefined && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-failed-soft px-3 py-2 text-sm text-ink"
        >
          <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-failed" />
          <span className="min-w-0 break-words whitespace-pre-wrap">{turnErrorText(reply.error)}</span>
        </div>
      )}
      {reply.usage && <UsageLine usage={reply.usage} />}
    </div>
  );
}

/** One turn: the prompt on the right, the reply on the left with its status and time. */
export function TurnView({
  turn,
  agentName,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly agentName: string;
}) {
  const reply = replyOf(turn);
  return (
    <li className="grid gap-3">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-blue px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-on-blue">
          {turn.prompt}
        </p>
      </div>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <span className="font-semibold text-ink-2">{agentName}</span>
          <StatusChip turn={turn} />
          <time dateTime={turn.createdAt}>{formatTime(turn.createdAt)}</time>
        </div>
        <ReplyBody turn={turn} reply={reply} />
      </div>
    </li>
  );
}

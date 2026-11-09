import { CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { formatTime } from '../../../components/data/format.ts';
import { turnErrorText } from '../chat-text.ts';
import type { TurnModel } from './model/parts.ts';
import { turnModel } from './model/turn-model.ts';
import { type Answering, QuestionCard } from './question/QuestionCard.tsx';
import { questionStatus } from './question/question-model.ts';
import { ReplyParts } from './ReplyParts.tsx';
import { TurnFooter } from './status/TurnFooter.tsx';
import { QueuedStatus, type RunsOn, WorkingStatus } from './status/WorkingStatus.tsx';
import { ClearDivider, CompactTurn } from './TurnMarkers.tsx';
import { TodoCard } from './todo/TodoCard.tsx';

/**
 * One turn of a chat (S5.1c, S5.2): the person's prompt on the right; the agent's reply on the left as its events build
 * it (Markdown text, quiet activity rows, subagent blocks), the to-do card, the agent's question (S5.2 step 4), and the
 * live status while it runs or the quiet summary once it ended. A Compact turn is a marker, a Clear a divider; a turn
 * whose prompt carried answers shows no prompt (the question's receipt stands for it).
 */

function FailedBox({ error }: { readonly error: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-failed-soft px-3 py-2 text-sm text-ink">
      <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-failed" />
      <span className="min-w-0 break-words whitespace-pre-wrap">{turnErrorText(error)}</span>
    </div>
  );
}

/** Where a turn stands in the thread, and how its question is answered. */
export interface TurnPlace {
  /** The chat's last turn: its question is open until answered. */
  readonly last: boolean;
  /** Its prompt carried answers to the agent's question. */
  readonly answer: boolean;
  readonly answering: Answering | undefined;
}

/** The agent's side of a message turn. */
function Reply({
  turn,
  model,
  agentName,
  runsOn,
  place,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly model: TurnModel;
  readonly agentName: string;
  readonly runsOn: RunsOn | undefined;
  readonly place: TurnPlace;
}) {
  const running = turn.status === 'running';
  return (
    <div className="grid min-w-0 gap-2.5">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-semibold text-ink-2">{agentName}</span>
        <time dateTime={turn.createdAt} className="text-faint tabular">
          {formatTime(turn.createdAt)}
        </time>
      </div>
      {model.parts.length > 0 && (
        <div className="grid min-w-0 gap-2">
          <ReplyParts parts={model.parts} model={model} live={running} />
        </div>
      )}
      {model.todo && model.todo.length > 0 && <TodoCard items={model.todo} live={running} />}
      {model.question && (
        <QuestionCard
          question={model.question}
          status={questionStatus(model.question, place.last)}
          running={running}
          answering={place.answering}
        />
      )}
      {model.error !== undefined && <FailedBox error={model.error} />}
      {running && <WorkingStatus turn={turn} model={model} runsOn={runsOn} />}
      {turn.status === 'queued' && <QueuedStatus />}
      <TurnFooter turn={turn} model={model} />
    </div>
  );
}

export function TurnView({
  turn,
  agentName,
  chatInit,
  place,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly agentName: string;
  /** What the chat last ran on (its detail's `init`), until the turn's own `init` says. */
  readonly chatInit: RunsOn | undefined;
  readonly place: TurnPlace;
}) {
  const model = useMemo(() => turnModel(turn), [turn]);
  if (turn.kind === 'clear') {
    return (
      <li>
        <ClearDivider />
      </li>
    );
  }
  if (turn.kind === 'compact') {
    return (
      <li>
        <CompactTurn turn={turn} model={model} />
      </li>
    );
  }
  return (
    <li className="grid gap-3">
      {!place.answer && (
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-blue px-3.5 py-2 text-sm break-words whitespace-pre-wrap text-on-blue shadow-primary">
            {turn.prompt}
          </p>
        </div>
      )}
      <Reply turn={turn} model={model} agentName={agentName} runsOn={model.init ?? chatInit} place={place} />
    </li>
  );
}

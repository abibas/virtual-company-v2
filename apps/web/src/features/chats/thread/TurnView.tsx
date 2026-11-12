import { CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { MessageAuthor } from '../../../components/feed/MessageAuthor.tsx';
import { BranchAction } from '../branch/BranchAction.tsx';
import type { BranchState } from '../branch/branch-state.ts';
import { turnErrorText } from '../chat-text.ts';
import { STARTED_NOTE } from '../delivery/delivery.ts';
import { type ThreadAuthors, useThreadLook } from './authors.ts';
import type { TurnModel } from './model/parts.ts';
import { turnModel } from './model/turn-model.ts';
import { PromptMessage } from './PromptMessage.tsx';
import { type Answering, QuestionCard } from './question/QuestionCard.tsx';
import { questionStatus } from './question/question-model.ts';
import { ReplyParts } from './ReplyParts.tsx';
import { MachineWaitStatus } from './status/MachineWait.tsx';
import { MessageActions, REVEAL_ACTIONS } from './status/MessageActions.tsx';
import { TurnFooter } from './status/TurnFooter.tsx';
import { QueuedStatus, type RunsOn, WorkingStatus } from './status/WorkingStatus.tsx';
import { ClearDivider, CompactTurn } from './TurnMarkers.tsx';
import { TodoCard } from './todo/TodoCard.tsx';

/**
 * One turn of a chat (S5.1c, S5.2): the prompt under its author's face (the reader's own on the right, `PromptMessage`);
 * the agent's reply on the left under its face as its events build it (Markdown text, quiet activity rows, subagent
 * blocks), the to-do card, the agent's question (S5.2 step 4), and the live status while it runs (or the machine's
 * progress while it waits for its stopped machine) or the quiet summary once it ended, with Copy and Branch under the
 * reply. A Compact turn is a marker, a Clear a divider; a turn whose prompt carried answers shows no prompt (the
 * question's receipt stands for it). The authors and the faces' size come from the thread (`ThreadLookContext`).
 */

function FailedBox({ error }: { readonly error: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-failed-soft px-3 py-2 text-sm leading-relaxed text-ink"
    >
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
  /** Branch under the reply (admins and owners): its state and what it does; none hides it. */
  readonly branch?: { readonly state: BranchState; readonly onBranch: () => Promise<void> } | undefined;
}

/** The Branch action for the reply's `more` slot, unless hidden. */
function branchOf(branch: TurnPlace['branch']) {
  if (branch === undefined || branch.state.kind === 'hidden') return undefined;
  return <BranchAction state={branch.state} onBranch={branch.onBranch} />;
}

/** The agent's side of a message turn. */
function Reply({
  turn,
  model,
  authors,
  dense,
  runsOn,
  place,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly model: TurnModel;
  readonly authors: ThreadAuthors;
  readonly dense: boolean;
  readonly runsOn: RunsOn | undefined;
  readonly place: TurnPlace;
}) {
  const running = turn.status === 'running';
  return (
    <MessageAuthor author={authors.agent} at={turn.createdAt} dense={dense} className="group/message">
      <div className="grid min-w-0 gap-3 pt-1">
        {model.parts.length > 0 && (
          <div className="grid min-w-0 gap-2.5">
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
        {turn.status === 'queued' &&
          (turn.machineWaitAt === null ? <QueuedStatus /> : <MachineWaitStatus turn={turn} />)}
        {!running && turn.status !== 'queued' && (
          <div className="-mt-1 flex min-h-7 min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <TurnFooter turn={turn} model={model} />
            </div>
            {model.replyText && (
              <MessageActions
                text={model.replyText}
                label="Copy reply"
                more={branchOf(place.branch)}
                className={REVEAL_ACTIONS}
              />
            )}
          </div>
        )}
      </div>
    </MessageAuthor>
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
  const { authors, dense } = useThreadLook(agentName);
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
  const note = turn.delivery ? STARTED_NOTE[turn.delivery] : undefined;
  return (
    <li className="grid gap-2">
      {!place.answer && (
        <PromptMessage
          prompt={turn.prompt}
          prompter={authors.prompter(turn)}
          at={turn.createdAt}
          note={note}
          dense={dense}
        />
      )}
      <Reply
        turn={turn}
        model={model}
        authors={authors}
        dense={dense}
        runsOn={model.init ?? chatInit}
        place={place}
      />
    </li>
  );
}

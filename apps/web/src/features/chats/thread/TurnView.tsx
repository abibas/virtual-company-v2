import { CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import type { Decision } from '../../../api/decisions.ts';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { MessageAuthor } from '../../../components/feed/MessageAuthor.tsx';
import { turnAnchor } from '../../agents/links.ts';
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
import { HomeMissingActions } from './status/HomeMissing.tsx';
import { MachineWaitStatus } from './status/MachineWait.tsx';
import { MessageActions, REVEAL_ACTIONS } from './status/MessageActions.tsx';
import { PostedInSlack } from './status/PostedInSlack.tsx';
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
<<<<<<< HEAD
 * question's receipt stands for it). The decisions the agent recorded show as cards where each was made (2026-11-14).
 * The authors and the faces' size come from the thread (`ThreadLookContext`).
=======
 * question's receipt stands for it). The authors and the faces' size come from the thread (`ThreadLookContext`). A
 * Slack message's turn (2026-11-14) shows only the message as its sender wrote it (`visibleText`; the agent got the
 * prompt with its header), and its reply says "Posted in Slack" once it was posted there.
>>>>>>> 2978883 (Contacts: the db's table counts with contacts, and the chat thread shows a Slack message as its sender's)
 */

/** What the reader sees of a turn's prompt: a message from outside as written (an empty one said so), else the prompt. */
const shownPrompt = (turn: Pick<ChatTurnWithEvents, 'prompt' | 'visibleText'>) =>
  turn.visibleText === null ? turn.prompt : turn.visibleText.trim() || '(no text)';

/** A turn's failure; the last turn's missing folder offers Create folder and Send again (`HomeMissingActions`). */
function FailedBox({ error, fix }: { readonly error: string; readonly fix: string | undefined }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-failed-soft px-3 py-2 text-sm leading-relaxed text-ink"
    >
      <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-failed" />
      <div className="min-w-0 flex-1">
        <span className="break-words whitespace-pre-wrap">{turnErrorText(error)}</span>
        {fix !== undefined && <HomeMissingActions prompt={fix} />}
      </div>
    </div>
  );
}

const NO_DECISIONS: readonly Decision[] = [];

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
        {model.error !== undefined && (
          <FailedBox
            error={model.error}
            fix={model.error === 'home_missing' && place.last ? turn.prompt : undefined}
          />
        )}
        {running && <WorkingStatus turn={turn} model={model} runsOn={runsOn} />}
        {turn.status === 'queued' &&
          (turn.machineWaitAt === null ? <QueuedStatus /> : <MachineWaitStatus turn={turn} />)}
        {!running && turn.status !== 'queued' && (
          <div className="-mt-1 flex min-h-7 min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <TurnFooter turn={turn} model={model} />
            </div>
            {turn.replyLink && <PostedInSlack link={turn.replyLink} />}
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
  decisions = NO_DECISIONS,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly agentName: string;
  /** What the chat last ran on (its detail's `init`), until the turn's own `init` says. */
  readonly chatInit: RunsOn | undefined;
  readonly place: TurnPlace;
  /** The decisions the agent recorded in this turn, oldest first: cards where each was made. */
  readonly decisions?: readonly Decision[] | undefined;
}) {
  const model = useMemo(() => turnModel(turn, decisions), [turn, decisions]);
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
    <li id={turnAnchor(turn.id)} className="grid scroll-mt-4 gap-2">
      {!place.answer && (
        <PromptMessage
          prompt={shownPrompt(turn)}
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

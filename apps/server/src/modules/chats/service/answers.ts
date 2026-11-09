import type { ChatTurn, TenantDb } from '@mwc/db';
import type { AnsweredEvent } from '@mwc/shared/harness';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import {
  answersProblem,
  answersPrompt,
  closedUnlessNext,
  findQuestion,
  invalidAnswers,
  QUESTION_CLOSED,
  QUESTION_NOT_FOUND,
  type QuestionTurn,
} from '../rules/questions.ts';
import { CHAT_NOT_FOUND, type Refusal } from '../rules.ts';
import type { AnswerQuestion, ChatTurnView } from '../schemas.ts';
import { startTurn, type TurnCaller, type TurnsDeps } from './turns.ts';
import { eventView, streamEvent } from './views.ts';

/**
 * Answering the agent's question (S5.2 step 4, docs/harness.md "Asking the person"): the answers must fit the open
 * question (`rules/questions.ts`); they start the chat's next turn with a prompt that says them in words, refused as any
 * turn is. In the transaction that records that turn, the question must still be open (no turn came after its own:
 * otherwise `question_closed`), and its turn gets an `answered` event naming the new turn, which the stream sends
 * before the new turn. A plain message instead closes the question without a mark: a newer turn supersedes it.
 */

type Started = { readonly ok: true; readonly turn: ChatTurnView } | Refusal;

/** The chat's turns with their events, as the rules read them. */
async function questionTurns(t: TenantDb, chatId: string): Promise<QuestionTurn[]> {
  const turns = await turnsRepo.ofChat(t, chatId);
  const events = await turnsRepo.eventsOf(
    t,
    turns.map((turn) => turn.id),
  );
  return turns.map((turn) => ({
    id: turn.id,
    seq: turn.seq,
    events: events.filter((event) => event.turnId === turn.id).map(eventView),
  }));
}

/** Answers the chat's open question (see above); 202 with the turn that carries the answers, or why not. */
export async function answerQuestion(
  deps: TurnsDeps,
  t: TenantDb,
  caller: TurnCaller,
  chatId: string,
  body: AnswerQuestion,
): Promise<Started> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  const found = findQuestion(await questionTurns(t, chat.id), body.questionId);
  if (found === undefined) return QUESTION_NOT_FOUND;
  if (found.state !== 'open') return QUESTION_CLOSED;
  const { questions } = found.event;
  const problem = answersProblem(questions, body.answers);
  if (problem !== undefined) return invalidAnswers(problem);
  const asked = found.turn;
  return startTurn(deps, t, caller, chat.id, answersPrompt(questions, body.answers), {
    kind: 'message',
    check: closedUnlessNext(asked.seq),
    alongside: async (tx, turn: ChatTurn) => {
      const event: AnsweredEvent = {
        type: 'answered',
        questionId: body.questionId,
        turnId: turn.id,
        answers: body.answers,
      };
      const seq = (await turnsRepo.lastEventSeq(tx, asked.id)) + 1;
      const [row] = await turnsRepo.insertEvents(tx, asked.id, [{ seq, event, at: deps.clock() }]);
      return () => {
        if (row !== undefined)
          deps.live.bus.publish(chat.id, { kind: 'event', event: streamEvent(asked, row) });
      };
    },
  });
}

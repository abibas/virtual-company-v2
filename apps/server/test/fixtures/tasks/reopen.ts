/**
 * The reopen tests' helpers (T-28, T-29): the run scene's flow cut to Develop → Code review, so a task closes at an
 * agent's step; a task taken through both by the agents' own tools until it is done there; a person's message in one
 * of its conversations with the turn the runner got for it; and a step's hand-off note as text. Never a real CLI: the
 * runner is the fake.
 */
import type { DbHandle } from '@mwc/db';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { type ChatsWorld, chatPath } from '../chats/world.ts';
import { as } from '../members/members.ts';
import type { Person } from '../platform/auth.ts';
import { artifactsOf, eventually, finish, type RunScene, taskRow } from '../runs.ts';
import { flowsPath, makeTask, stepOf, type TaskDetailView, tasksPath } from '../tasks.ts';
import { toolCall } from '../tools.ts';

/** The scene's flow without its Approve step: Code review, the Code Reviewer's, is the last and closes the task. */
export async function reviewClosesIt(w: ChatsWorld, s: RunScene): Promise<void> {
  const steps = [
    {
      id: stepOf(s.flow, 'Develop').id,
      name: 'Develop',
      kind: 'work',
      assigneePrincipalId: s.c.developer,
      starts: 'auto',
    },
    {
      id: stepOf(s.flow, 'Code review').id,
      name: 'Code review',
      kind: 'check',
      assigneePrincipalId: s.c.reviewer,
      starts: 'auto',
      sendsBackTo: 'Develop',
      sendBackLimit: 3,
    },
  ];
  const res = await as(w, s.c.owner)('PUT', flowsPath(s.c, `/${s.flow.id}/steps`), { steps });
  if (res.status !== 200) throw new Error(`PUT steps answered ${res.status}: ${JSON.stringify(res.body)}`);
}

/** A task done at Code review: handed on by the Developer, passed by the Code Reviewer, both with their tools. */
export interface ClosedTask {
  readonly task: TaskDetailView;
  /** Its Develop and Code review conversations. */
  readonly develop: string;
  readonly review: string;
}

/** Cuts the flow (`reviewClosesIt`) and takes a new task through it until it is done at Code review. */
export async function closedAtReview(w: ChatsWorld, s: RunScene): Promise<ClosedTask> {
  await reviewClosesIt(w, s);
  const made = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  const develop = await s.runner.frames.next('turn.start');
  await toolCall(s.runner, develop.turnId, 'task_hand_on', { summary: 'Fixed on fix/login.' });
  finish(s.runner, develop, 'Fixed on fix/login.');
  const review = await s.runner.frames.next('turn.start');
  await toolCall(s.runner, review.turnId, 'task_pass', { findings: 'Looks right.' });
  finish(s.runner, review, 'PASS');
  await eventually('the task is done', async () => (await taskRow(w.t.db, made.id)).state === 'done');
  const res = await as(w, s.c.owner)('GET', tasksPath(s.c, `/${made.key}`));
  const task = res.body as TaskDetailView;
  const [first, second] = task.conversations;
  return { task, develop: first?.chatId as string, review: second?.chatId as string };
}

/** `by` (the owner unless said) writes in the conversation; the turn the runner got for it. */
export async function said(
  w: ChatsWorld,
  s: RunScene,
  chatId: string,
  prompt: string,
  by: Person = s.c.owner,
): Promise<TurnStart> {
  const res = await as(w, by)('POST', chatPath(s.c, chatId, '/turns'), { prompt });
  if (res.status !== 202) throw new Error(`POST turns answered ${res.status}: ${JSON.stringify(res.body)}`);
  return s.runner.frames.next('turn.start');
}

/**
 * The step's hand-off note of the task (its latest round's) with its text, or undefined for none; the bytes as text, so
 * PGlite's Uint8Array and Postgres's Buffer read alike.
 */
export async function handOffNote(db: DbHandle, taskId: string, stepName: string) {
  const notes = (await artifactsOf(db, taskId)).filter(
    (row) => row.stepName === stepName && row.name === 'hand-off note',
  );
  const note = notes.at(-1);
  return note && { ...note, text: new TextDecoder().decode(note.bytes ?? new Uint8Array()) };
}

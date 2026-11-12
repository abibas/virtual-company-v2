import { createHash } from 'node:crypto';
import type { FlowStep, Task, TenantDb } from '@mwc/db';
import { type AttachInput, clipText, stepPrompt, TOOL_RESULT_MAX, taskKey } from '@mwc/shared/flows';
import type { TaskTurnContext } from '../../chats/index.ts';
import type { CollectedArtifact } from '../../machines/index.ts';
import { principalNames } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import { stepToolRefusal } from '../rules/decision.ts';
import { noteBytes } from '../rules/runs.ts';
import { attachedText, decisionText, whereText } from '../rules/tool-text.ts';
import { storeFile } from './artifacts.ts';
import type { ToolReply } from './decision.ts';
import { type RunDeps, stepPromptInput } from './runs.ts';
import { decisionView, taskSummary } from './views.ts';

/**
 * A step's own tools besides its moves (S6a): `task_read`, the task as the step's full prompt writes it (the task, its
 * flow, the step, the round, the hand-off, the artifacts) and where it is now with the decision recorded so far; and
 * `task_attach`, which keeps a note, a link or a file of the turn's outputs folder with the task now, as the step's
 * agent, in the step's round. Attaching needs the task still at the turn's step.
 */

/** `task_read`: the task as the step sees it, then where it is now. */
export async function readTask(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  turn: TaskTurnContext,
): Promise<ToolReply> {
  const task = (await repo.tasks.get(t, { id: turn.taskId })) as Task;
  const steps = await repo.flows.steps(t, task.flowId);
  const step = steps.find((s) => s.id === turn.stepId);
  if (step === undefined) return { ok: false, text: 'Your step is no longer in the flow.' };
  const flow = await repo.flows.get(t, task.flowId);
  const names = await principalNames(deps.db, t, [flow?.leadPrincipalId, task.createdBy, task.decision?.by]);
  const { all } = await stepPromptInput(deps, repo, t, task, step);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const summary = taskSummary(task, byId, flow?.leadPrincipalId ?? '', names);
  const decision = decisionView(task, names);
  const now = [
    `${summary.key} is ${whereText(summary)}.`,
    decision ? `Recorded in this turn: ${decisionText(decision)}.` : 'No move recorded in this turn yet.',
  ].join('\n');
  const text = `${stepPrompt({ ...all, tools: true }, 'full')}\n\n## Now\n\n${now}`;
  return { ok: true, text: clipText(text, TOOL_RESULT_MAX) };
}

/** Where an artifact of the turn goes, in words: its task's key, its step's name, its round. */
const placeOf = (task: Task, step: FlowStep, round: number) => ({
  key: taskKey(task.number),
  step: step.name,
  round,
});

/** The fields every artifact the turn attaches shares. */
const baseOf = (task: Task, step: FlowStep, turn: TaskTurnContext) => ({
  taskId: task.id,
  stepId: step.id,
  stepName: step.name,
  round: turn.round,
  chatId: turn.chatId,
  turnId: turn.turnId,
  createdBy: turn.agentPrincipalId,
});

/** `task_attach`: a note, a link or a file of the outputs folder, kept now (see above). */
export async function attachTo(
  repo: TasksRepo,
  t: TenantDb,
  turn: TaskTurnContext,
  input: AttachInput,
  file: CollectedArtifact | undefined,
): Promise<ToolReply> {
  const task = (await repo.tasks.get(t, { id: turn.taskId })) as Task;
  const step = (await repo.flows.steps(t, task.flowId)).find((s) => s.id === turn.stepId);
  const refused = stepToolRefusal(task, step, turn, 'task_attach');
  if (refused) return { ok: false, text: refused.message.replace('recorded', 'attached') };
  const at = step as FlowStep;
  const place = placeOf(task, at, turn.round);
  if (input.path !== undefined) {
    if (file === undefined || file.path !== input.path)
      return {
        ok: false,
        text: `The file ${input.path} did not arrive from the runner: nothing was attached.`,
      };
    await storeFile(repo, t, turn, file);
    return { ok: true, text: attachedText(file.path, 'file', place) };
  }
  const name = input.name as string;
  if (input.url !== undefined) {
    const link = {
      name,
      kind: 'link',
      contentType: null,
      size: 0,
      sha256: null,
      bytes: null,
      note: input.url,
    } as const;
    await repo.artifacts.upsert(t, { ...baseOf(task, at, turn), ...link });
    return { ok: true, text: attachedText(name, 'link', place) };
  }
  const bytes = noteBytes(input.text as string);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const contentType = 'text/markdown; charset=utf-8';
  const note = { name, kind: 'note', contentType, size: bytes.length, sha256, bytes, note: null } as const;
  await repo.artifacts.upsert(t, { ...baseOf(task, at, turn), ...note });
  return { ok: true, text: attachedText(name, 'note', place) };
}

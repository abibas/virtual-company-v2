import { createHash } from 'node:crypto';
import type { DbHandle, Task, TaskArtifact, TenantDb } from '@mwc/db';
import { HANDOFF_NOTE } from '@mwc/shared/flows';
import type { TaskTurnContext } from '../../chats/index.ts';
import type { CollectedArtifact, TurnCollected } from '../../machines/index.ts';
import type { ArtifactRow, TasksRepo } from '../repo.ts';
import { noteBytes, skipWords } from '../rules/runs.ts';
import { type Refusal, refuse, TASK_NOT_FOUND, type TaskRef } from '../rules.ts';
import type { ArtifactView } from '../schemas/artifacts.ts';
import { namesOf } from './team.ts';

/**
 * A task's artifacts (S5.3b, docs/processes.md "Built in S5.3b"): what a step's turn left, kept with the task, the step
 * and the round it ran in (the files the runner collected, the files it left out, and the turn's final reply as the
 * step's hand-off note), and reading them back (a task's list without the bytes, one artifact's bytes). Each is written
 * as the step's agent (`created_by`), with the conversation and the turn that made it.
 */

type Deps = { readonly db: DbHandle };

/** The step's name for a row (its name as it is now; a step removed since keeps a placeholder). */
const stepNameOf = async (repo: TasksRepo, t: TenantDb, turn: TaskTurnContext): Promise<string> => {
  const task = (await repo.tasks.get(t, { id: turn.taskId })) as Task;
  const steps = await repo.flows.steps(t, task.flowId);
  return steps.find((step) => step.id === turn.stepId)?.name ?? 'a removed step';
};

/** The row's fields every artifact of a turn shares. */
async function base(repo: TasksRepo, t: TenantDb, turn: TaskTurnContext) {
  return {
    taskId: turn.taskId,
    stepId: turn.stepId,
    stepName: await stepNameOf(repo, t, turn),
    round: turn.round,
    chatId: turn.chatId,
    turnId: turn.turnId,
    createdBy: turn.agentPrincipalId,
  };
}

/** Keeps a collected file (put together and checked by the hub). */
export async function storeFile(
  repo: TasksRepo,
  t: TenantDb,
  turn: TaskTurnContext,
  file: CollectedArtifact,
) {
  const { path, contentType, size, sha256, bytes } = file;
  await repo.artifacts.upsert(t, {
    ...(await base(repo, t, turn)),
    name: path,
    kind: 'file',
    contentType,
    size,
    sha256,
    bytes,
    note: null,
  });
}

/** Keeps the files the runner left out, each with why. */
export async function storeSkipped(
  repo: TasksRepo,
  t: TenantDb,
  turn: TaskTurnContext,
  collected: TurnCollected,
) {
  if (collected.skipped.length === 0) return;
  const shared = await base(repo, t, turn);
  for (const skipped of collected.skipped) {
    await repo.artifacts.upsert(t, {
      ...shared,
      name: skipped.path,
      kind: 'skipped',
      contentType: null,
      size: Math.min(skipped.size, 2 ** 31 - 1),
      sha256: null,
      bytes: null,
      note: skipWords(skipped.reason),
    });
  }
}

/** Keeps the turn's final reply as the step's hand-off note of the round (the latest reply of the round wins). */
export async function storeNote(repo: TasksRepo, t: TenantDb, turn: TaskTurnContext, text: string) {
  const bytes = noteBytes(text);
  await repo.artifacts.upsert(t, {
    ...(await base(repo, t, turn)),
    name: HANDOFF_NOTE,
    kind: 'note',
    contentType: 'text/markdown; charset=utf-8',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
    note: null,
  });
}

/** An artifact as the API shows it (never its bytes). */
export function artifactView(
  row: ArtifactRow,
  names: (id: string) => ArtifactView['createdBy'],
): ArtifactView {
  return {
    id: row.id,
    step: { id: row.stepId, name: row.stepName },
    round: row.round,
    name: row.name,
    kind: row.kind,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
    note: row.note,
    chatId: row.chatId,
    turnId: row.turnId,
    createdBy: names(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A task's artifacts, oldest first, without their bytes; 404 for another company's task or none. */
export async function listArtifacts(deps: Deps, repo: TasksRepo, t: TenantDb, ref: TaskRef | undefined) {
  const task = ref === undefined ? undefined : await repo.tasks.get(t, ref);
  if (task === undefined) return TASK_NOT_FOUND;
  const rows = await repo.artifacts.ofTask(t, task.id);
  const names = await namesOf(
    deps.db,
    repo,
    t,
    rows.map((row) => row.createdBy),
  );
  return { ok: true as const, artifacts: rows.map((row) => artifactView(row, names)) };
}

export const ARTIFACT_NOT_FOUND = refuse(
  404,
  'artifact_not_found',
  'No such artifact with content on this task',
);

/** One artifact with its bytes; 404 for another company's task, none, or an artifact without bytes (a link, a skip). */
export async function artifactFile(
  repo: TasksRepo,
  t: TenantDb,
  ref: TaskRef | undefined,
  artifactId: string,
): Promise<{ readonly ok: true; readonly artifact: TaskArtifact & { bytes: Uint8Array } } | Refusal<404>> {
  const task = ref === undefined ? undefined : await repo.tasks.get(t, ref);
  if (task === undefined) return TASK_NOT_FOUND;
  const artifact = await repo.artifacts.get(t, task.id, artifactId);
  if (artifact?.bytes == null) return ARTIFACT_NOT_FOUND;
  return { ok: true, artifact: artifact as TaskArtifact & { bytes: Uint8Array } };
}

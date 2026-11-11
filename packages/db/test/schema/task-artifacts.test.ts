import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  flows,
  type NewTaskArtifact,
  type Principal,
  type Task,
  taskArtifacts,
  tasks,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let agent: Principal;
let task: Task;
let theirTask: Task;
let number = 0;

async function taskOf(company: Company, lead: Principal): Promise<Task> {
  const [flow] = await handle.db
    .insert(flows)
    .values({ companyId: company.id, leadPrincipalId: lead.id, name: 'Delivery', createdBy: lead.id })
    .returning();
  const [row] = await handle.db
    .insert(tasks)
    .values({
      companyId: company.id,
      number: ++number,
      flowId: flow?.id as string,
      title: 'T',
      createdBy: lead.id,
    })
    .returning();
  return row as Task;
}

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  agent = await insertPrincipal(handle, acme.id, 'agent');
  task = await taskOf(acme, agent);
  theirTask = await taskOf(globex, await insertPrincipal(handle, globex.id));
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

const bytesOf = (text: string) => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let names = 0;

/** A collected file's row (`notes-<n>.md`), with `values` over it. */
function file(values: Partial<NewTaskArtifact> = {}) {
  const bytes = bytesOf('# Notes');
  return handle.db
    .insert(taskArtifacts)
    .values({
      companyId: acme.id,
      taskId: task.id,
      stepId: MISSING_ID,
      stepName: 'Develop',
      round: 1,
      name: `notes-${++names}.md`,
      kind: 'file',
      contentType: 'text/markdown; charset=utf-8',
      size: bytes.length,
      sha256: sha(bytes),
      bytes,
      createdBy: agent.id,
      ...values,
    })
    .returning();
}

const skipped = (values: Partial<NewTaskArtifact> = {}) =>
  file({ kind: 'skipped', contentType: null, sha256: null, bytes: null, note: 'too_large', ...values });

describe('task_artifacts', () => {
  it('keeps a file with its bytes, a note, a skipped file’s size and reason, and a link', async () => {
    const [row] = await file();
    expect(row).toMatchObject({ kind: 'file', size: 7, chatId: null, turnId: null });
    expect(new TextDecoder().decode(row?.bytes)).toBe('# Notes');
    expect((await file({ kind: 'note', name: 'hand-off note' }))[0]?.kind).toBe('note');
    expect((await skipped({ size: 5 * 1024 * 1024 }))[0]?.size).toBe(5 * 1024 * 1024);
    expect((await skipped({ kind: 'link', size: 0, note: 'https://example.test/pr/1' }))[0]?.kind).toBe(
      'link',
    );
  });

  it('keeps one name per task, step and round', async () => {
    await file({ name: 'same.md' });
    expect(await constraint(file({ name: 'same.md' }))).toBe('task_artifacts_name_unique');
    expect((await file({ name: 'same.md', round: 2 }))[0]?.round).toBe(2);
  });

  it('refuses a bad kind, round, names, size, hash, note or type', async () => {
    const bare = { bytes: null, contentType: null, sha256: null };
    expect(await constraint(file({ ...bare, kind: 'blob' as never }))).toBe('task_artifacts_kind_check');
    expect(await constraint(file({ round: 0 }))).toBe('task_artifacts_round_check');
    expect(await constraint(file({ stepName: '' }))).toBe('task_artifacts_step_name_check');
    expect(await constraint(file({ name: '' }))).toBe('task_artifacts_name_check');
    expect(await constraint(file({ name: 'n'.repeat(256) }))).toBe('task_artifacts_name_check');
    expect(await constraint(file({ size: 8 }))).toBe('task_artifacts_bytes_check');
    expect(await constraint(skipped({ size: -1 }))).toBe('task_artifacts_size_check');
    expect(await constraint(file({ sha256: 'ABC' }))).toBe('task_artifacts_sha256_check');
    expect(await constraint(file({ contentType: '' }))).toBe('task_artifacts_content_type_check');
    expect(await constraint(skipped({ note: '' }))).toBe('task_artifacts_note_check');
  });

  it('keeps the bytes, the type and the hash together, and a note only on links and skipped files', async () => {
    expect(await constraint(file({ bytes: null }))).toBe('task_artifacts_bytes_check');
    expect(await constraint(file({ contentType: null }))).toBe('task_artifacts_bytes_check');
    expect(await constraint(file({ sha256: null }))).toBe('task_artifacts_bytes_check');
    expect(await constraint(skipped({ bytes: bytesOf('x'), size: 1 }))).toBe('task_artifacts_bytes_check');
    expect(await constraint(file({ note: 'why' }))).toBe('task_artifacts_note_kind_check');
    expect(await constraint(skipped({ note: null }))).toBe('task_artifacts_note_kind_check');
  });

  it("refuses another company's task, chat, turn or creator", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(file({ taskId: theirTask.id }))).toBe('task_artifacts_task_fk');
    expect(await constraint(file({ createdBy: theirs.id }))).toBe('task_artifacts_created_by_fk');
    expect(await constraint(file({ chatId: MISSING_ID }))).toBe('task_artifacts_chat_fk');
    expect(await constraint(file({ turnId: MISSING_ID }))).toBe('task_artifacts_turn_fk');
  });
});

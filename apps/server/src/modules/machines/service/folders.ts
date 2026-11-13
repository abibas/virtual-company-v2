import { diffFields, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import {
  FOLDERS_TIMEOUT_MS,
  type FsList,
  type FsMkdir,
  type FsMkdirp,
  type FsResult,
} from '@mwc/shared/runner-protocol';
import { machinesRepo } from '../repo.ts';
import {
  FOLDERS_TIMED_OUT,
  type FolderListing,
  folderRefusal,
  listingOf,
  RUNNER_CANNOT_MAKE,
  RUNNER_OUTDATED,
} from '../rules/folders.ts';
import { MACHINE_NOT_FOUND, MACHINE_OFFLINE, type Refusal } from '../rules.ts';
import { HubError, type RunnerHub } from './runner/hub.ts';

/**
 * The folder browser (S5.1d, docs/machines.md "The folder browser"): a machine's folders read through its runner
 * (`fs.list`) and a new folder made there (`fs.mkdir`, audited), for choosing an agent's home folder; or a folder with
 * its parents (`fs.mkdirp`, 2026-11-13, audited when made), for an agent's home folder that is not there yet. The runner
 * keeps its own rules (absolute paths, `/work` only in a container, its user's home for `fs.mkdirp`); this side checks the
 * machine, its connection and that its runner knows the frame (`caps.folders`, `caps.mkdirp`), and waits
 * `FOLDERS_TIMEOUT_MS` for the answer.
 */

export interface FoldersDeps {
  readonly hub: RunnerHub;
  /** How long a runner has to answer; `FOLDERS_TIMEOUT_MS` unless a test shortens it. */
  readonly timeoutMs?: number;
}

/** Who makes the folder. */
export interface FolderCaller {
  readonly principalId: string;
  readonly requestId: string;
}

type FolderRefusal = Refusal<404> | Refusal<409> | Refusal<422> | Refusal<504>;

const repo = machinesRepo();

/** Sends a folder frame to the machine's runner and returns its `ok` answer, or the refusal. */
async function ask(
  deps: FoldersDeps,
  t: TenantDb,
  machineId: string,
  frame: FsList | FsMkdir | FsMkdirp,
): Promise<FsResult | FolderRefusal> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const runner = deps.hub.connected(machine.id);
  if (runner === undefined) return MACHINE_OFFLINE;
  if (!runner.caps.folders) return RUNNER_OUTDATED;
  if (frame.type === 'fs.mkdirp' && !runner.caps.mkdirp) return RUNNER_CANNOT_MAKE;
  let reply: FsResult | { readonly type: 'cmd.ack' };
  try {
    reply = await deps.hub.request(machine.id, frame, { timeoutMs: deps.timeoutMs ?? FOLDERS_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof HubError)) throw error;
    return error.code === 'timeout' ? FOLDERS_TIMED_OUT : MACHINE_OFFLINE;
  }
  if (reply.type === 'cmd.ack') return frame.type === 'fs.mkdirp' ? RUNNER_CANNOT_MAKE : RUNNER_OUTDATED;
  return reply.ok ? reply : folderRefusal(reply.error);
}

/** The folders in `path` on the machine (its default start when null). */
export async function listFolders(
  deps: FoldersDeps,
  t: TenantDb,
  machineId: string,
  path: string | null,
): Promise<({ readonly ok: true } & FolderListing) | FolderRefusal> {
  const reply = await ask(deps, t, machineId, { type: 'fs.list', cmdId: newId(), path });
  return 'cmdId' in reply ? { ok: true, ...listingOf(reply, path) } : reply;
}

/** A folder made on the machine, or found there (`fs.mkdirp`). */
export interface MadeFolder {
  readonly ok: true;
  readonly path: string;
  readonly created: boolean;
}

/** Audits a folder the caller made on the machine. */
async function audited(t: TenantDb, caller: FolderCaller, machineId: string, folder: string) {
  await repo.audit(t, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: 'machine',
    entityId: machineId,
    action: 'folder_create',
    changes: diffFields(null, { folder }),
  });
}

/**
 * Makes the folder `path` on the machine, audited as the caller's: one folder whose parent exists, or with `parents` the
 * folder and its missing parents inside the runner's roots (an existing folder is no error, and nothing is audited).
 */
export async function makeFolder(
  deps: FoldersDeps,
  t: TenantDb,
  caller: FolderCaller,
  machineId: string,
  request: { readonly path: string; readonly parents?: boolean | undefined },
): Promise<MadeFolder | FolderRefusal> {
  const { path } = request;
  const type = request.parents === true ? 'fs.mkdirp' : 'fs.mkdir';
  const reply = await ask(deps, t, machineId, { type, cmdId: newId(), path });
  if (!('cmdId' in reply)) return reply;
  const made = reply.path ?? path;
  const created = reply.created ?? true;
  if (created) await audited(t, caller, machineId, made);
  return { ok: true, path: made, created };
}

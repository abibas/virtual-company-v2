import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CODEX_AUTH_FILE } from '@mwc/harness-codex';
import type { PrivateDir, ProcessSpec } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import { CodexAuthJson } from '@mwc/shared/harness';

/**
 * The folders a harness keeps its state in (docs/harness.md, "The port": Codex's `CODEX_HOME`, Claude Code's private
 * settings files). The folder is the placement's configuration folder, or the runner's own one for the harness and the
 * agent's folder (`<state>/<harness>/<first 16 hex of sha256(cwd)>/`), never the machine's `~/.codex` or `~/.claude`. The runner makes it (0700) when
 * missing and keeps it (the threads a resume needs live there). It writes the driver's files (the login, 0600) before
 * the process and removes them when the last process using the folder ends, so a login is on disk only while a process
 * runs; a file of that name it did not write is set aside and put back, never overwritten. A file whose text changed
 * while the process ran (Codex refreshed its token) is handed back. A marker names the files the runner wrote, so after
 * a crash the next use knows them as its own and puts the folder back first. Contents are never logged.
 */

/** The file operations the folders need, synchronous (`nodePrivateFs`, `files.ts`). */
export interface PrivateFs {
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
  /** Makes a folder and its parents; new ones get 0700. */
  mkdir(path: string): void;
  /** A file's text; undefined when there is none. */
  read(path: string): string | undefined;
  /** Writes a file with `mode`, also when it is there already. */
  write(path: string, text: string, mode: number): void;
  rename(from: string, to: string): void;
  /** Removes a file; a missing one is fine. */
  remove(path: string): void;
}

/** The marker of the files the runner wrote in a folder, one name a line. */
export const WRITTEN_MARKER = '.mwc-runner-files';

/** Where a file of that name the runner did not write waits while a process uses the folder. */
export const asideName = (name: string): string => `.${name}.mwc-aside`;

/** One process's use of a folder. */
export interface PrivateLease {
  /** The folder, for the driver's variable. */
  readonly path: string;
  /** Ends this use (once): the texts of the runner's files that changed meanwhile, by name; the last use removes them. */
  release(): Readonly<Record<string, string>>;
}

interface Folder {
  users: number;
  /** What the runner last wrote in each of its files (or last saw there). */
  readonly written: Map<string, string>;
  /** The files it set aside, to put back. */
  readonly aside: Set<string>;
}

/**
 * Ends a process's use of its folder and gives the Codex login it rewrote meanwhile (its token refreshed): the text,
 * `invalid` when it is no login the server would take, or undefined when nothing changed (or there was no folder).
 */
export function releaseLogin(lease: PrivateLease | undefined): string | 'invalid' | undefined {
  const changed = lease?.release()[CODEX_AUTH_FILE];
  if (changed === undefined) return undefined;
  return CodexAuthJson.safeParse(changed).success ? changed : 'invalid';
}

/**
 * A process spec once its private folder is ready: each file with an `option` named after the spec's arguments with its
 * full path (Claude Code's `--settings <path>`), and the folder's variable (`CODEX_HOME`) for its environment. Without a
 * lease, the spec as it is.
 */
export function withPrivateDir(
  process: ProcessSpec,
  lease: PrivateLease | undefined,
): { readonly process: ProcessSpec; readonly env: Readonly<Record<string, string>> } {
  const dir = process.privateDir;
  if (dir === undefined || lease === undefined) return { process, env: {} };
  const named = dir.files.flatMap((file) => (file.option ? [file.option, join(lease.path, file.name)] : []));
  const env = dir.env === undefined ? {} : { [dir.env]: lease.path };
  return { process: named.length === 0 ? process : { ...process, args: [...process.args, ...named] }, env };
}

/** The folder of a private dir: the driver's (the placement's configuration folder), else the runner's own. */
export function privatePath(dir: PrivateDir, stateDir: string, harness: Harness, cwd: string): string {
  if (dir.path !== null) return dir.path;
  return join(stateDir, harness, createHash('sha256').update(cwd).digest('hex').slice(0, 16));
}

export class PrivateDirs {
  readonly #fs: PrivateFs;
  readonly #stateDir: string;
  readonly #folders = new Map<string, Folder>();

  constructor(deps: { readonly fs: PrivateFs; readonly stateDir: string }) {
    this.#fs = deps.fs;
    this.#stateDir = deps.stateDir;
  }

  /** The folders in use now (tests). */
  get inUse(): string[] {
    return [...this.#folders.keys()];
  }

  /** Makes the folder ready for one more process and writes its files; throws what the file system throws. */
  acquire(dir: PrivateDir, harness: Harness, cwd: string): PrivateLease {
    const path = privatePath(dir, this.#stateDir, harness, cwd);
    const folder = this.#folders.get(path) ?? this.#open(path);
    folder.users++;
    try {
      for (const file of dir.files) this.#writeFile(path, folder, file);
    } catch (error) {
      this.#release(path, folder);
      throw error;
    }
    let released = false;
    return {
      path,
      release: () => {
        if (released) return {};
        released = true;
        return this.#release(path, folder);
      },
    };
  }

  /** A folder not in use: made when missing, and put back as it was when a crashed runner left its files there. */
  #open(path: string): Folder {
    if (!this.#fs.isDirectory(path)) this.#fs.mkdir(path);
    const left = this.#fs.read(join(path, WRITTEN_MARKER));
    for (const name of left?.split('\n').filter(Boolean) ?? []) {
      this.#fs.remove(join(path, name));
      const aside = join(path, asideName(name));
      if (this.#fs.exists(aside)) this.#fs.rename(aside, join(path, name));
    }
    if (left !== undefined) this.#fs.remove(join(path, WRITTEN_MARKER));
    const folder: Folder = { users: 0, written: new Map(), aside: new Set() };
    this.#folders.set(path, folder);
    return folder;
  }

  #writeFile(path: string, folder: Folder, file: PrivateDir['files'][number]): void {
    const target = join(path, file.name);
    if (!folder.written.has(file.name) && this.#fs.exists(target)) {
      this.#fs.rename(target, join(path, asideName(file.name)));
      folder.aside.add(file.name);
    }
    folder.written.set(file.name, file.contents);
    // The marker first: a crash between the two leaves a file the next use knows as the runner's.
    this.#fs.write(join(path, WRITTEN_MARKER), `${[...folder.written.keys()].join('\n')}\n`, 0o600);
    this.#fs.write(target, file.contents, file.mode);
  }

  #release(path: string, folder: Folder): Record<string, string> {
    folder.users--;
    const changed: Record<string, string> = {};
    for (const [name, text] of folder.written) {
      const now = this.#fs.read(join(path, name));
      if (now !== undefined && now !== text) {
        changed[name] = now;
        folder.written.set(name, now);
      }
    }
    if (folder.users > 0) return changed;
    for (const name of folder.written.keys()) this.#fs.remove(join(path, name));
    for (const name of folder.aside) this.#fs.rename(join(path, asideName(name)), join(path, name));
    this.#fs.remove(join(path, WRITTEN_MARKER));
    this.#folders.delete(path);
    return changed;
  }
}

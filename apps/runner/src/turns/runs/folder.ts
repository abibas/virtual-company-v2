import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Harness } from '@mwc/shared/enums';
import { AskQuestions, TurnEvent } from '@mwc/shared/harness';
import { z } from 'zod';

/**
 * A turn's run folder (S5.4, docs/harness.md "Surviving restarts"): `<state>/runs/<12 hex of sha256(turn id)>/`, 0700,
 * which outlives the runner. `meta.json` says what the turn is (never its credential, a token or an environment value);
 * the keeper (`keeper.ts`) appends the harness's stdout to `out` and its stderr to `err`, listens on `k.sock` and writes
 * `exit.json` when the harness ends; the runner appends every event it numbered to `events.jsonl` (with how far into
 * `out` it had read) and every message it wrote into the turn to `inputs.jsonl`. The folder goes once the server
 * acknowledged the turn's end, or after `RUN_RETENTION_MS`.
 */

/** Where the run folders live under the runner's state folder. */
export const runsRoot = (stateDir: string) => join(stateDir, 'runs');

/** How long an ended turn's folder is kept when its end was never acknowledged (an older server, a turn forgotten). */
export const RUN_RETENTION_MS = 24 * 60 * 60_000;

export const RUN_FILES = {
  meta: 'meta.json',
  out: 'out',
  err: 'err',
  exit: 'exit.json',
  events: 'events.jsonl',
  inputs: 'inputs.jsonl',
  socket: 'k.sock',
} as const;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** What the runner needs to take a turn back after its restart. */
export const RunMeta = z.object({
  v: z.literal(1),
  turnId: z.uuid(),
  harness: Harness,
  cwd: z.string().min(1),
  /** The keeper's pid, which is its process group's (the harness runs in it). */
  pid: z.int().positive(),
  /** When the turn started, milliseconds since the epoch. */
  startedAt: z.int().nonnegative(),
  /** Whether the harness takes messages while it works (Claude Code's input mode). */
  stdinOpen: z.boolean(),
  /** The private folder the turn's files are in: their names and SHA-256 (never their text), and the ones set aside. */
  privateDir: z
    .object({
      path: z.string().min(1),
      files: z.array(z.object({ name: z.string().min(1), sha256: Sha256 })),
      aside: z.array(z.string().min(1)),
    })
    .nullable(),
  /** A task step's outputs folder and what was in it before the turn (path → size:time). */
  artifacts: z
    .object({ root: z.string().min(1), before: z.array(z.tuple([z.string(), z.string()])) })
    .nullable(),
  /** The turn's question socket's folder and its token's SHA-256 (never the token). */
  ask: z.object({ dir: z.string().min(1), tokenSha256: Sha256 }).nullable(),
  /** Set once a stop began: a turn that ends without its exit recorded was stopped, not lost. */
  stopping: z.boolean().optional(),
  /** The number its events come after (`turn.start.afterSeq`): a restarted runner never numbers one again. */
  afterSeq: z.int().nonnegative().optional(),
});
export type RunMeta = z.infer<typeof RunMeta>;

/** How the harness ended, as the keeper wrote it. */
export const RunExit = z.object({
  code: z.int().nullable(),
  signal: z.string().nullable(),
  error: z.string().optional(),
});
export type RunExit = z.infer<typeof RunExit>;

/** One line of `events.jsonl`: an event, a question, or the end of the output; `o` is how far into `out` it was read. */
const LogRecord = z.union([
  z.object({ s: z.int().min(1), o: z.int().nonnegative(), e: TurnEvent }),
  z.object({
    s: z.int().min(1),
    o: z.int().nonnegative(),
    q: z.object({ questionId: z.uuid(), questions: AskQuestions }),
  }),
  z.object({ fin: z.literal(true), o: z.int().nonnegative() }),
]);
export type LogRecord = z.infer<typeof LogRecord>;

/** One line of `inputs.jsonl`: a message written into the turn, or stdin closed. */
const InputRecord = z.union([
  z.object({ id: z.uuid(), text: z.string() }),
  z.object({ end: z.literal(true) }),
]);
export type InputRecord = z.infer<typeof InputRecord>;

/** The JSON lines of a file that parse; a torn last line (a write cut short) and anything else are skipped. */
function readLines<T>(path: string, schema: z.ZodType<T>): T[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const records: T[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // A torn line: what it said is read again or resent.
    }
  }
  return records;
}

export class RunFolder {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** A turn's folder under `root`, made 0700 (empty, as a fresh turn's). */
  static create(root: string, turnId: string): RunFolder {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const dir = join(root, createHash('sha256').update(turnId).digest('hex').slice(0, 12));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
    return new RunFolder(dir);
  }

  /** The run folders under `root`. */
  static list(root: string): RunFolder[] {
    try {
      return readdirSync(root).map((name) => new RunFolder(join(root, name)));
    } catch {
      return [];
    }
  }

  path(file: keyof typeof RUN_FILES): string {
    return join(this.dir, RUN_FILES[file]);
  }

  /** Writes `meta.json` whole (a temporary file renamed over it). */
  writeMeta(meta: RunMeta): void {
    const temp = `${this.path('meta')}.tmp`;
    writeFileSync(temp, JSON.stringify(meta), { mode: 0o600 });
    renameSync(temp, this.path('meta'));
  }

  /** `meta.json`, or undefined when it is missing or not one. */
  meta(): RunMeta | undefined {
    try {
      const parsed = RunMeta.safeParse(JSON.parse(readFileSync(this.path('meta'), 'utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** `exit.json`, or undefined before the keeper wrote it. */
  exit(): RunExit | undefined {
    try {
      const parsed = RunExit.safeParse(JSON.parse(readFileSync(this.path('exit'), 'utf8')));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** When the folder last changed (its exit, else its meta), in milliseconds; 0 when neither is there. */
  changedAt(): number {
    for (const file of ['exit', 'meta'] as const) {
      try {
        return statSync(this.path(file)).mtimeMs;
      } catch {
        // The next one.
      }
    }
    return 0;
  }

  appendEvents(records: readonly LogRecord[]): void {
    if (records.length === 0) return;
    appendFileSync(this.path('events'), records.map((record) => `${JSON.stringify(record)}\n`).join(''), {
      mode: 0o600,
    });
  }

  events(): LogRecord[] {
    return readLines(this.path('events'), LogRecord);
  }

  appendInput(record: InputRecord): void {
    appendFileSync(this.path('inputs'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  }

  inputs(): InputRecord[] {
    return readLines(this.path('inputs'), InputRecord);
  }

  /** Removes the folder and everything in it; quiet when it is gone. */
  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

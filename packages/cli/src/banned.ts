/**
 * The banned-names guard (CLAUDE.md, "No legacy naming"): names, paths and identifiers from earlier
 * versions of the product never appear in this repository. `mwc check` scans every file git tracks or
 * would track, and the commit-msg hook scans each commit message.
 *
 * The terms are built from parts so that this list never contains them itself, and `git grep` for a
 * term finds nothing. Add a term the same way: `['paper' + 'clip', 'old' + 'name']`. Matching is
 * case-insensitive and finds a term inside longer words too.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BANNED_TERMS: readonly string[] = ['paper' + 'clip'];

/** Files that are not scanned: written by tools, not by us (the lockfile lists package names). */
export const SKIPPED_FILES: ReadonlySet<string> = new Set(['pnpm-lock.yaml']);

export interface BannedHit {
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  readonly term: string;
}

/** Every line of `text` that holds a banned term, case-insensitively. */
export function scanText(file: string, text: string, terms: readonly string[] = BANNED_TERMS): BannedHit[] {
  const lowered = terms.map((term) => term.toLowerCase());
  const hits: BannedHit[] = [];
  text.split('\n').forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const term of lowered) if (lower.includes(term)) hits.push({ file, line: index + 1, term });
  });
  return hits;
}

/** Git's own rule for binary content: a NUL byte in the first 8000 bytes. */
export function isBinary(content: Uint8Array): boolean {
  return content.subarray(0, 8000).includes(0);
}

export interface ScanDeps {
  /** Paths relative to the repo root. */
  listFiles(): string[];
  /** The file's content, or undefined when it is gone from the working tree. */
  readFile(path: string): Uint8Array | undefined;
}

/** Scans every listed file except the skipped and the binary ones. */
export function scanFiles(deps: ScanDeps, terms: readonly string[] = BANNED_TERMS): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const file of deps.listFiles()) {
    if (SKIPPED_FILES.has(file)) continue;
    const content = deps.readFile(file);
    if (content === undefined || isBinary(content)) continue;
    hits.push(...scanText(file, Buffer.from(content).toString('utf8'), terms));
  }
  return hits;
}

/** Git's scissors line: with `git commit -v`, everything after it (the diff) is not part of the message. */
const SCISSORS = '# ------------------------ >8 ------------------------';

/** The part of a commit message file that becomes the message: before the scissors, without `#` lines. */
export function commitMessageText(raw: string): string {
  const cut = raw.indexOf(SCISSORS);
  return (cut >= 0 ? raw.slice(0, cut) : raw)
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

export function formatHits(hits: readonly BannedHit[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line}: banned name "${hit.term}"\n`).join('');
}

/**
 * The files git tracks plus the untracked ones it does not ignore (so a new file is caught before
 * it is committed), in one `git ls-files` process.
 */
export function systemScanDeps(root: string): ScanDeps {
  return {
    listFiles() {
      const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
      });
      if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr || result.error}`);
      return [...new Set(result.stdout.split('\0').filter(Boolean))];
    },
    readFile(path) {
      try {
        return readFileSync(join(root, path));
      } catch {
        return undefined;
      }
    },
  };
}

import { randomBytes } from 'node:crypto';
import type { PrivateFile } from '@mwc/harness-core';
import type { TerminalSpec } from '@mwc/shared/harness';

/**
 * The standing instructions on Claude Code (docs/harness.md, "Standing instructions"): the agent's place in the company
 * and its own instructions, appended to Claude Code's system prompt from a private file the runner writes
 * (`--append-system-prompt-file <path>`, a hidden option of `claude` that `--help` names under `--bare`; the text and
 * `--append-system-prompt` go together since 2.1.283, the file's first), never on the command line, where every user
 * of the machine would see it in `ps` and a long text would hit the argument limit. With the runner's tools, the line
 * on when to ask the person goes at the end of the same file instead of `--append-system-prompt`.
 *
 * Claude Code records a conversation's system prompt on its first request and sends that record on every later request
 * and resume, even when a later launch passes different text, until a compaction (`--system-prompt-snapshot`, on by
 * default since 2.1.267). So that a change of the chart reaches the next turn of a chat, a process with standing
 * instructions renders the prompt fresh on every request (`--system-prompt-snapshot off`), as Claude Code did before it
 * recorded it. Without standing instructions nothing changes.
 */

/** The option that names the file. */
export const INSTRUCTIONS_OPTION = '--append-system-prompt-file';

/** The system prompt rendered fresh on each request, so new standing instructions reach a resumed conversation. */
export const SNAPSHOT_OFF = ['--system-prompt-snapshot', 'off'] as const;

/** The arguments a process with standing instructions gets before the runner's (none without them). */
export const snapshotArgs = (spec: TerminalSpec): readonly string[] =>
  spec.instructions === undefined ? [] : SNAPSHOT_OFF;

/**
 * The file of one process's standing instructions, with `extra` (the line on asking the person) after them: a name of
 * its own (two chats of agents sharing a folder run at once), 0600, named with `--append-system-prompt-file`. None
 * without standing instructions.
 */
export function instructionsFile(spec: TerminalSpec, extra?: string): PrivateFile | undefined {
  if (spec.instructions === undefined) return undefined;
  return {
    name: `instructions-${randomBytes(6).toString('hex')}.md`,
    contents: extra === undefined ? spec.instructions : `${spec.instructions}\n\n${extra}`,
    mode: 0o600,
    option: INSTRUCTIONS_OPTION,
  };
}

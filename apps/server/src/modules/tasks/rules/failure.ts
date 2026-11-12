import { disconnectedWords } from '@mwc/shared/chats';

// Why a step's turn failed, in words (pure): the runner's and the server's codes a turn's error starts with (`busy`,
// `home_missing`, `spawn_failed: …`, `machine_disconnected`, …) become a sentence naming the machine, so a task's block,
// the task page, the Inbox and a Lead's wake-up never show a bare code. Words already (a refusal's, a wait's, the
// words of `machine_disconnected: <words>`) pass as they are.

type Words = (machine: string, detail: string) => string;

/** A sentence starting with the machine's name ("the machine" when unknown) starts with a capital. */
const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const WORDS: Readonly<Record<string, Words>> = {
  busy: (m) => `${cap(m)} had no free slot`,
  unsupported: (m) => `The runner on ${m} cannot run this harness`,
  home_missing: (m) => `The agent's folder is not on ${m}: check where it runs`,
  invalid_spec: (_m, d) => `The runner refused the turn's settings${d}`,
  spawn_failed: (m, d) => `The harness did not start on ${m}${d}`,
  stopped: () => 'The turn was stopped',
  runner_stopping: (m) => `The runner on ${m} stopped`,
  process_lost: (m) => `The turn's process on ${m} ended without its result`,
  machine_disconnected: (m) => `${cap(m)} disconnected during the turn`,
  server_restarted: () => 'The server restarted during the turn',
  machine_offline: (m) => `${cap(m)} went offline before the turn started`,
};

/** A code with optional words after `: ` ("spawn_failed: ENOENT"), as a turn's error carries it. */
const CODED = /^([a-z_]+)(?::\s*(.*))?$/s;

/**
 * A turn's error in words, naming its machine (null: "the machine"): a known code becomes its sentence, with its own
 * words in brackets; anything else is returned as it is.
 */
export function failureWords(error: string, machine: string | null): string {
  const away = disconnectedWords(error);
  if (away !== undefined) return away;
  const match = CODED.exec(error.trim());
  const words = match === null ? undefined : WORDS[match[1] as string];
  if (match === null || words === undefined) return error;
  const detail = match[2]?.trim() ?? '';
  return words(machine ?? 'the machine', detail === '' ? '' : ` (${detail})`);
}

/** A reason as people read it: a bare code stored before reasons were words, in words; null stays null. */
export const readableReason = (reason: string | null): string | null =>
  reason === null ? null : failureWords(reason, null);

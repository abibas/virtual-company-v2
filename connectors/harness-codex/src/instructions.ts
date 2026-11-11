import type { PrivateFile } from '@mwc/harness-core';
import type { TerminalSpec } from '@mwc/shared/harness';

/**
 * The standing instructions on Codex (docs/harness.md, "Standing instructions"): the agent's place in the company and
 * its own instructions, as the global instructions file of the Codex home the runner manages (`CODEX_HOME`), written
 * for the process's lifetime like the login. Codex reads `AGENTS.override.md` (else `AGENTS.md`) of its home before
 * each request and keeps what it last showed the model as part of the thread's state, so a new text reaches a resumed
 * thread at its next turn ("These AGENTS.md instructions replace all previously provided AGENTS.md instructions."), and
 * an unchanged one is not sent again (Codex 0.162.1 to 0.167.0, `codex-home/src/instructions`, the `agents_md` section
 * of `core/src/context/world_state`). The project's own `AGENTS.md` files still follow it. A file of that name the
 * runner did not write (a placement whose configuration folder is a person's Codex home) is set aside while the
 * process runs and put back after. `developer_instructions` would not do: Codex sends it only with a thread's first
 * context, so a resumed thread would keep the old text.
 */

/** The file in Codex's home that Codex reads first for its global instructions. */
export const CODEX_INSTRUCTIONS_FILE = 'AGENTS.override.md';

/** The instructions file of one process, or none without standing instructions. */
export function codexInstructionsFiles(spec: TerminalSpec): PrivateFile[] {
  if (spec.instructions === undefined) return [];
  return [{ name: CODEX_INSTRUCTIONS_FILE, contents: spec.instructions, mode: 0o600 }];
}

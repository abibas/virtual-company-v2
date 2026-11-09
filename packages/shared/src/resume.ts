import type { Harness, MachineKind, MachineProvider } from './enums.ts';

/**
 * "Open in Claude Code" (S5.2 step 6, docs/harness.md "Open in Claude Code"): the commands that resume a chat's
 * conversation in the person's own terminal, on the machine it lives on and in the folder it began in. The devbox is
 * reached with its own CLI from the person's Mac, a container with `docker exec` where Docker runs it, any other machine
 * in a terminal on it. Every path is quoted for a POSIX shell, and a command that goes through a second shell (ssh,
 * `sh -lc`) is quoted once more for the first. Pure; the web shows them with copy buttons.
 */

/** The machine the conversation lives on, as the machines list shows it. */
export interface ResumeMachine {
  readonly name: string;
  readonly kind: MachineKind;
  readonly provider: MachineProvider;
  /** A container's hostname is its short id, which `docker exec` takes. */
  readonly hostname: string;
}

export interface ResumeTarget {
  readonly harness: Harness;
  /** The harness's conversation (Claude Code's session, Codex's thread). */
  readonly sessionId: string;
  /** The folder it began in: Claude Code keeps sessions by folder, so a resume runs there. */
  readonly folder: string;
  /** The agent's config folder (`CLAUDE_CONFIG_DIR`, Codex's `CODEX_HOME`), when it has one. */
  readonly configDir: string | null;
  readonly machine: ResumeMachine | undefined;
}

export interface ResumeCommand {
  /** Where to run it. */
  readonly where: string;
  readonly command: string;
}

/** `text` as one single-quoted word for a POSIX shell (a `'` inside becomes `'\''`). */
export const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

const PLAIN = /^[A-Za-z0-9._/:@%+=,-]+$/;

/** `text` as it is when a shell reads it as one plain word, else single-quoted. */
export const shellWord = (text: string): string => (PLAIN.test(text) ? text : shellQuote(text));

/** `text` in double quotes for a shell, so it reaches the next shell as it is (`\`, `"`, `$` and backquotes escaped). */
export const doubleQuoted = (text: string): string => `"${text.replace(/[\\"$`]/g, '\\$&')}"`;

/** The line that resumes the conversation in its folder: `cd '<folder>' && claude --resume <id>`. */
export function resumeLine(target: Omit<ResumeTarget, 'machine'>): string {
  const id = shellWord(target.sessionId);
  const home = target.harness === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  const env = target.configDir === null ? '' : `${home}=${shellQuote(target.configDir)} `;
  const tool = target.harness === 'codex' ? `codex resume ${id}` : `claude --resume ${id}`;
  return `cd ${shellQuote(target.folder)} && ${env}${tool}`;
}

/** The commands for the conversation's machine, the one to run from the person's own computer first. */
export function resumeCommands(target: ResumeTarget): ResumeCommand[] {
  const line = resumeLine(target);
  const machine = target.machine;
  if (machine?.provider === 'airia_devbox') {
    return [
      {
        where: 'In a Terminal on your Mac (it starts the box if it is stopped)',
        command: `airia devbox ssh -- -t ${doubleQuoted(line)}`,
      },
      { where: 'In a shell on the box', command: line },
    ];
  }
  if (machine?.kind === 'container') {
    const container = shellWord(machine.hostname);
    return [
      {
        where: 'Where Docker runs the container',
        command: `docker exec -it ${container} sh -lc ${doubleQuoted(line)}`,
      },
      { where: 'In a shell in the container', command: line },
    ];
  }
  return [{ where: `In a Terminal on ${machine?.name ?? 'the machine'}`, command: line }];
}

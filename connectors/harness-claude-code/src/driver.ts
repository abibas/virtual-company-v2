import { randomUUID } from 'node:crypto';
import {
  checkSpec,
  checkTurn,
  type HarnessDriver,
  type LineParser,
  type ProcessSpec,
  type TurnTools,
} from '@mwc/harness-core';
import type { TerminalSpec, TurnSpec } from '@mwc/shared/harness';
import {
  CLAUDE_COMMAND,
  claudeEnv,
  forkArgs,
  MCP_CONFIG_FILE,
  mcpConfig,
  sharedArgs,
  TURN_ARGS,
  toolArgs,
  unsetFor,
} from './args.ts';
import { INPUT_ARGS, userLine } from './input.ts';
import { ClaudeLineParser } from './parser.ts';
import { settingsDir } from './settings.ts';

export interface ClaudeCodeDriverOptions {
  /** The `claude` program's full path, when the runner found it; `claude` on PATH otherwise. */
  readonly command?: string;
}

/**
 * The Claude Code `HarnessDriver` (docs/harness.md, "Claude Code"). A turn is
 * `claude -p --output-format stream-json --verbose --input-format stream-json --replay-user-messages [--resume <id>]
 * [--model <m>] [--effort <e>] [--dangerously-skip-permissions]` (a branch's first turn adds `--fork-session` and maybe
 * `--resume-session-at <uuid>`, `forkArgs`) with the prompt as the first user message on stdin,
 * which stays open for the person's messages while the turn runs (`inputLine`, `input.ts`); a terminal is the same
 * without the print-mode arguments, the TUI.
 * With the runner's tools a turn also gets its MCP server (`--mcp-config <dir>/mcp.json`, the file written by the runner),
 * the question tool allowed and one line of system prompt (`toolArgs`). Every turn and terminal gets a private settings
 * file the runner writes and names with `--settings <path>` (`settings.ts`): the profile's gateway, or Anthropic's own
 * address, over whatever the machine's settings say.
 */
export class ClaudeCodeDriver implements HarnessDriver {
  readonly harness = 'claude_code' as const;
  readonly versionArgs = ['--version'] as const;
  readonly command: string;

  constructor(options: ClaudeCodeDriverOptions = {}) {
    this.command = options.command ?? CLAUDE_COMMAND;
  }

  turn(spec: TurnSpec, tools?: TurnTools): ProcessSpec {
    checkTurn(this.harness, spec);
    const args = [...TURN_ARGS, ...INPUT_ARGS, ...sharedArgs(spec), ...forkArgs(spec)];
    const first = userLine(spec.prompt, randomUUID());
    if (tools === undefined) return { ...this.#process(args, spec, first), stdinOpen: true };
    const file = { name: MCP_CONFIG_FILE, contents: mcpConfig(tools), mode: 0o600 };
    const process = this.#process([...args, ...toolArgs(tools)], spec, first);
    return { ...process, stdinOpen: true, turnFiles: [file] };
  }

  terminal(spec: TerminalSpec): ProcessSpec {
    checkSpec(this.harness, spec);
    return this.#process(sharedArgs(spec), spec, null);
  }

  parser(): LineParser {
    return new ClaudeLineParser();
  }

  inputLine(text: string, id: string): string {
    return userLine(text, id);
  }

  #process(args: string[], spec: TerminalSpec, stdin: string | null): ProcessSpec {
    const env = claudeEnv(spec);
    const privateDir = settingsDir(spec.gateway);
    return { command: this.command, args, env, unsetEnv: unsetFor(env), stdin, privateDir, notices: [] };
  }
}

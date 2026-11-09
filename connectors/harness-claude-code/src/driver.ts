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
  MCP_CONFIG_FILE,
  mcpConfig,
  sharedArgs,
  TURN_ARGS,
  toolArgs,
  unsetFor,
} from './args.ts';
import { ClaudeLineParser } from './parser.ts';

export interface ClaudeCodeDriverOptions {
  /** The `claude` program's full path, when the runner found it; `claude` on PATH otherwise. */
  readonly command?: string;
}

/**
 * The Claude Code `HarnessDriver` (docs/harness.md, "Claude Code"). A turn is
 * `claude -p --output-format stream-json --verbose [--resume <id>] [--model <m>] [--effort <e>]
 * [--dangerously-skip-permissions]` with the prompt on stdin; a terminal is the same without the first four, the TUI.
 * With the runner's tools a turn also gets its MCP server (`--mcp-config <dir>/mcp.json`, the file written by the runner),
 * the question tool allowed and one line of system prompt (`toolArgs`).
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
    const args = [...TURN_ARGS, ...sharedArgs(spec)];
    if (tools === undefined) return this.#process(args, spec, spec.prompt);
    const file = { name: MCP_CONFIG_FILE, contents: mcpConfig(tools), mode: 0o600 };
    return { ...this.#process([...args, ...toolArgs(tools)], spec, spec.prompt), turnFiles: [file] };
  }

  terminal(spec: TerminalSpec): ProcessSpec {
    checkSpec(this.harness, spec);
    return this.#process(sharedArgs(spec), spec, null);
  }

  parser(): LineParser {
    return new ClaudeLineParser();
  }

  #process(args: string[], spec: TerminalSpec, stdin: string | null): ProcessSpec {
    const env = claudeEnv(spec);
    return { command: this.command, args, env, unsetEnv: unsetFor(env), stdin, notices: [] };
  }
}

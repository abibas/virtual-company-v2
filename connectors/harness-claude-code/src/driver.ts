import {
  checkSpec,
  checkTurn,
  type HarnessDriver,
  type LineParser,
  type ProcessSpec,
} from '@mwc/harness-core';
import type { TerminalSpec, TurnSpec } from '@mwc/shared/harness';
import { CLAUDE_COMMAND, claudeEnv, sharedArgs, TURN_ARGS, unsetFor } from './args.ts';
import { ClaudeLineParser } from './parser.ts';

export interface ClaudeCodeDriverOptions {
  /** The `claude` program's full path, when the runner found it; `claude` on PATH otherwise. */
  readonly command?: string;
}

/**
 * The Claude Code `HarnessDriver` (docs/harness.md, "Claude Code"). A turn is
 * `claude -p --output-format stream-json --verbose [--resume <id>] [--model <m>] [--effort <e>]
 * [--dangerously-skip-permissions]` with the prompt on stdin; a terminal is the same without the first four, the TUI.
 */
export class ClaudeCodeDriver implements HarnessDriver {
  readonly harness = 'claude_code' as const;
  readonly versionArgs = ['--version'] as const;
  readonly command: string;

  constructor(options: ClaudeCodeDriverOptions = {}) {
    this.command = options.command ?? CLAUDE_COMMAND;
  }

  turn(spec: TurnSpec): ProcessSpec {
    checkTurn(this.harness, spec);
    return this.#process([...TURN_ARGS, ...sharedArgs(spec)], spec, spec.prompt);
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

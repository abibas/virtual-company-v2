import {
  checkSpec,
  checkTurn,
  type HarnessDriver,
  type LineParser,
  type ParserContext,
  type ProcessSpec,
  type TurnTools,
} from '@mwc/harness-core';
import type { TerminalSpec, TurnSpec } from '@mwc/shared/harness';
import { CODEX_COMMAND, CODEX_HOME_ENV, codexAccount, terminalArgs, turnArgs, unsetFor } from './args.ts';
import { gatewayEnv } from './gateway.ts';
import { CodexLineParser } from './parser.ts';
import { type RolloutFs, readRollout } from './rollout.ts';

export interface CodexDriverOptions {
  /** The `codex` program's full path, when the runner found it; `codex` on PATH otherwise. */
  readonly command?: string;
  /** The file calls that read Codex's session file when a turn ends (`rollout.ts`); without them, the estimate only. */
  readonly rollouts?: RolloutFs;
}

/**
 * The Codex `HarnessDriver` (docs/harness.md, "Codex"). A turn is `codex exec --json --skip-git-repo-check … -` (or
 * `codex exec resume … <thread> -`, a branch's first `codex exec fork … <thread> -`) with the prompt on stdin; a terminal is `codex …` (or `codex resume … <thread>`).
 * Codex always runs in a home folder the runner manages (`CODEX_HOME`: the turn's `configDir`, or the runner's own per
 * `cwd`), where its threads stay between turns and its login is written for the process's lifetime only. With the
 * runner's tools a turn also gets its MCP server as config overrides, and the server's variables in its environment.
 * The access profile's gateway is a custom model provider in config overrides, its headers' values in the environment
 * (`gateway.ts`); without one, Codex's built-in OpenAI provider. With `rollouts`, a turn's parser reads the thread's
 * session file in that home folder when the turn ends, for Codex's own context reading.
 */
export class CodexDriver implements HarnessDriver {
  readonly harness = 'codex' as const;
  readonly versionArgs = ['--version'] as const;
  readonly command: string;
  readonly #rollouts: RolloutFs | undefined;

  constructor(options: CodexDriverOptions = {}) {
    this.command = options.command ?? CODEX_COMMAND;
    this.#rollouts = options.rollouts;
  }

  turn(spec: TurnSpec, tools?: TurnTools): ProcessSpec {
    checkTurn(this.harness, spec);
    const process = this.#process(turnArgs(spec, tools), spec, 'exec', spec.prompt);
    return tools === undefined ? process : { ...process, env: { ...process.env, ...tools.env } };
  }

  terminal(spec: TerminalSpec): ProcessSpec {
    checkSpec(this.harness, spec);
    return this.#process(terminalArgs(spec), spec, 'tui', null);
  }

  parser(context: ParserContext = {}): LineParser {
    const fs = this.#rollouts;
    const home = context.privateDir;
    return new CodexLineParser(
      fs === undefined || home === undefined ? undefined : (thread) => readRollout(fs, home, thread),
    );
  }

  #process(args: string[], spec: TerminalSpec, mode: 'exec' | 'tui', stdin: string | null): ProcessSpec {
    const account = codexAccount(spec.credential, mode);
    return {
      command: this.command,
      args,
      env: { ...account.env, ...gatewayEnv(spec.gateway) },
      unsetEnv: unsetFor(account.env),
      stdin,
      privateDir: { env: CODEX_HOME_ENV, path: spec.configDir, files: account.files },
      notices: [],
    };
  }
}

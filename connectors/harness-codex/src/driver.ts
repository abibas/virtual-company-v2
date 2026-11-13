import {
  checkSpec,
  checkTurn,
  type HarnessDriver,
  type LineParser,
  lineMatching,
  type ParserContext,
  type ProcessSpec,
  type TurnTools,
} from '@mwc/harness-core';
import type { TerminalSpec, TurnSpec } from '@mwc/shared/harness';
import { CODEX_COMMAND, CODEX_HOME_ENV, codexAccount, terminalArgs, turnArgs, unsetFor } from './args.ts';
import { readChild } from './children.ts';
import { LiveSubagents } from './follow/live.ts';
import { gatewayEnv } from './gateway.ts';
import { codexInstructionsFiles } from './instructions.ts';
import { CodexLineParser } from './parser.ts';
import { type RolloutFs, readRollout } from './rollout.ts';

/**
 * Codex's words when `codex exec resume <id>` (or `fork`) names a thread its home does not have (0.167.0, on stderr as
 * it exits with 1): "Error: thread/resume: thread/resume failed: no rollout found for thread id <id> (code -32600)";
 * its app server also says "conversation id".
 */
export const CODEX_SESSION_MISSING = /no rollout found for (thread|conversation) id/i;

export interface CodexDriverOptions {
  /** The `codex` program's full path, when the runner found it; `codex` on PATH otherwise. */
  readonly command?: string;
  /**
   * The file calls that read Codex's session files (`rollout.ts`): the thread's when a turn ends, each subagent's when it
   * ends (`children.ts`); without them, the estimate only and subagents without their model.
   */
  readonly rollouts?: RolloutFs;
  /**
   * The wall clock in milliseconds (`Date.now`): when a turn's parser was made is when its turn started, unless the
   * runner names the turn's start (`ParserContext.startedAt`, a re-attached turn).
   */
  readonly now?: () => number;
}

/**
 * The Codex `HarnessDriver` (docs/harness.md, "Codex"). A turn is `codex exec --json --skip-git-repo-check … -` (or
 * `codex exec resume … <thread> -`, a branch's first `codex exec fork … <thread> -`) with the prompt on stdin; a terminal is `codex …` (or `codex resume … <thread>`).
 * Codex always runs in a home folder the runner manages (`CODEX_HOME`: the turn's `configDir`, or the runner's own per
 * `cwd`), where its threads stay between turns and its login is written for the process's lifetime only. With the
 * runner's tools a turn also gets its MCP server as config overrides, and the server's variables in its environment.
 * The access profile's gateway is a custom model provider in config overrides, its headers' values in the environment
 * (`gateway.ts`); without one, Codex's built-in OpenAI provider. With `rollouts`, a turn's parser reads the thread's
 * session file in that home folder when the turn ends, for Codex's own context reading, and each subagent's own file
 * once it ends, for its model, role and last command; while the turn runs it follows the thread's file and its
 * subagents' (`follow/`): multi-agent v2's subagents and every subagent's own commands, live. Standing instructions
 * (the agent's place in the company and its own) are that home's `AGENTS.override.md` (`instructions.ts`).
 */
export class CodexDriver implements HarnessDriver {
  readonly harness = 'codex' as const;
  readonly versionArgs = ['--version'] as const;
  readonly command: string;
  readonly #rollouts: RolloutFs | undefined;
  readonly #now: () => number;

  constructor(options: CodexDriverOptions = {}) {
    this.command = options.command ?? CODEX_COMMAND;
    this.#rollouts = options.rollouts;
    this.#now = options.now ?? Date.now;
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
    if (fs === undefined || home === undefined) return new CodexLineParser();
    const since = context.startedAt ?? this.#now();
    return new CodexLineParser(
      (thread) => readRollout(fs, home, thread),
      (thread) => readChild(fs, home, thread),
      (state) => new LiveSubagents({ fs, home, since }, state),
    );
  }

  sessionMissing(output: string): string | undefined {
    return lineMatching(output, CODEX_SESSION_MISSING);
  }

  #process(args: string[], spec: TerminalSpec, mode: 'exec' | 'tui', stdin: string | null): ProcessSpec {
    const account = codexAccount(spec.credential, mode);
    return {
      command: this.command,
      args,
      env: { ...account.env, ...gatewayEnv(spec.gateway) },
      unsetEnv: unsetFor(account.env),
      stdin,
      privateDir: {
        env: CODEX_HOME_ENV,
        path: spec.configDir,
        files: [...account.files, ...codexInstructionsFiles(spec)],
      },
      notices: [],
    };
  }
}

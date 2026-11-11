import type { Harness } from '@mwc/shared/enums';
import type { TerminalSpec, TurnEvent, TurnEventOf, TurnSpec } from '@mwc/shared/harness';

/** A file a process reads from its private folder (Codex's `auth.json`, Claude Code's settings). */
export interface PrivateFile {
  /** A plain file name, no folders. */
  readonly name: string;
  readonly contents: string;
  /** Its permission bits, `0o600` for a secret. */
  readonly mode: number;
  /**
   * The option the process gets this file's full path with (Claude Code's `--settings`): the runner adds `option path`
   * after the spec's `args`, since only it knows the folder. Left out, the process finds the file by itself.
   */
  readonly option?: string;
}

/**
 * The folder a harness keeps its state in, or the files of a process, when the driver needs the runner to manage it
 * (Codex's `CODEX_HOME`, where its login and its threads live; Claude Code's private settings file). The runner makes it
 * private (0700) when missing, puts its path in `env` when there is one, writes `files` before the start (each with an
 * `option` named on the command line) and removes them when the last process using the folder exits, so no secret stays
 * on disk between turns. The folder itself is kept: a Codex thread lives in it, so a resume needs the same folder.
 */
export interface PrivateDir {
  /** The variable that gets the folder's path, e.g. `CODEX_HOME`; left out, none. */
  readonly env?: string;
  /**
   * The folder: the turn's `configDir` (the agent's own), or null for the runner's own private folder for this harness
   * and `cwd` (docs/harness.md).
   */
  readonly path: string | null;
  readonly files: readonly PrivateFile[];
}

/** The variables that tell the runner's MCP server where the turn's socket is and the token it must present. */
export const ASK_SOCKET_ENV = 'MWC_ASK_SOCKET';
export const ASK_TOKEN_ENV = 'MWC_ASK_TOKEN';
/** The variable that names the agents' tools the turn's MCP server offers (S6a), comma-joined; absent: none. */
export const TOOLS_ENV = 'MWC_TOOLS';

/**
 * The runner's tools a turn may call (docs/harness.md, "Asking the person" and "Agents' tools"): its MCP server, which a
 * harness starts as `command args` with `env` (the socket and its token, and the agents' tools it offers) and which
 * relays an `ask_user_question` call, or a call of an agents' tool (S6a), to the runner, and this turn's own folder
 * (0700), which the runner makes before the start and removes after the exit. A driver that needs a file for it (Claude
 * Code's `--mcp-config`) names it in `ProcessSpec.turnFiles`, and allows `names` (Claude Code's `--allowedTools`).
 */
export interface TurnTools {
  readonly dir: string;
  /** `<node>`: the runner's own Node. */
  readonly command: string;
  /** `[<runner.mjs>, 'mcp']`. */
  readonly args: readonly string[];
  /** `ASK_SOCKET_ENV` and `ASK_TOKEN_ENV`, and `TOOLS_ENV` when it offers agents' tools. */
  readonly env: Readonly<Record<string, string>>;
  /** The MCP tools its server offers: `ask_user_question` first, then the turn's agents' tools in order. */
  readonly names: readonly string[];
}

/** A notice the runner sends before the process's own events (a setting the harness cannot honour). */
export type TurnNotice = TurnEventOf<'notice'>;

/**
 * How to start one turn or terminal (pure data: nothing runs). The runner starts `command` in the spec's `cwd` with
 * its own environment minus `MWC_*` and minus `unsetEnv`, plus `env`; it writes `stdin` to the process and closes it
 * (a terminal gets the pseudo-terminal instead), or with `stdinOpen` keeps it open for the person's messages while the
 * turn runs (`HarnessDriver.inputLine`) and closes it once the harness answered them all (`LineParser.settled`).
 */
export interface ProcessSpec {
  /** The program: a name looked up on PATH, or the full path a driver was given. */
  readonly command: string;
  /** Its arguments, no shell. */
  readonly args: readonly string[];
  /** Only the variables to add or override. */
  readonly env: Readonly<Record<string, string>>;
  /** Variables of the runner's own environment the process must not see (another credential, another gateway). */
  readonly unsetEnv: readonly string[];
  /** The prompt, written to stdin and then closed (never an argument); null for a terminal. */
  readonly stdin: string | null;
  /**
   * The harness takes more messages on stdin while the turn runs (S5.2 step 6, Claude Code's stream-json input): the
   * runner keeps stdin open after `stdin` and closes it after a `result` once every message it wrote was taken.
   */
  readonly stdinOpen?: boolean;
  readonly privateDir?: PrivateDir;
  /** Files the runner writes in the turn's tools folder (`TurnTools.dir`) before the start: Claude Code's MCP config. */
  readonly turnFiles?: readonly PrivateFile[];
  /** What the person should know before the output (sent as the turn's first events, shown above a terminal). */
  readonly notices: readonly TurnNotice[];
}

/**
 * Reads one turn's stdout, a line at a time (without its newline), into normalized events. It is stateful (one per
 * process) and never throws: a blank, partial or garbled line and an unknown message type give no events. `end` is
 * called once, after the exit, with the exit code (null when a signal ended it) and the last of stderr; it gives a
 * failing `result` when the output gave none, and nothing otherwise.
 */
export interface LineParser {
  feed(line: string): TurnEvent[];
  end(exitCode: number | null, stderrTail: string): TurnEvent[];
  /**
   * With `stdinOpen`: true once the harness answered every message it took (its last line was a result and it says
   * nothing waits), so stdin may close. Left out: true after any result.
   */
  settled?(): boolean;
  /**
   * What the harness wrote elsewhere since the last call (Codex's subagents in its session files): the runner calls it
   * every `PARSER_TICK_MS` while the process runs, between lines, and never after `end`. Left out: nothing to follow.
   */
  tick?(): TurnEvent[];
}

/** How often the runner calls a parser's `tick`. */
export const PARSER_TICK_MS = 1000;

/** Where a turn's harness keeps its state, for a parser that reads the harness's own files while and after the turn. */
export interface ParserContext {
  /** The turn's private folder (Codex's `CODEX_HOME`), when it has one. */
  readonly privateDir?: string;
  /**
   * When the turn started (milliseconds since the epoch), for a parser that tells this turn's lines in the harness's
   * own files from earlier ones; a runner re-attaching a turn after its restart passes the turn's own start (S5.4).
   * Left out: when the parser is made.
   */
  readonly startedAt?: number;
}

/**
 * The harness driver port (docs/harness.md): what a runner loads to run a harness's CLI. Pure: it builds process
 * specs and parsers, and never spawns anything. `turn` and `terminal` throw a `HarnessError` only (a credential of
 * the other harness, an id that would break the command line).
 */
export interface HarnessDriver {
  readonly harness: Harness;
  /** The arguments that print the CLI's version (`claude --version`): what the runner reports in its hello. */
  readonly versionArgs: readonly string[];
  /** One chat turn, its output streamed as JSON lines; with `tools`, the runner's MCP server is the harness's too. */
  turn(spec: TurnSpec, tools?: TurnTools): ProcessSpec;
  /** The interactive TUI on the conversation (resumed, or a new one when `sessionId` is null). */
  terminal(spec: TerminalSpec): ProcessSpec;
  /** A new parser for one turn's output; `context` says where the turn's harness keeps its state. */
  parser(context?: ParserContext): LineParser;
  /**
   * The stdin line that gives a running turn of a `stdinOpen` process the person's message `text` (S5.2 step 6). The
   * harness's echo of it once it takes it is an `input` event with `inputId` = `id`. Left out: no message mid-turn.
   */
  inputLine?(text: string, id: string): string;
}

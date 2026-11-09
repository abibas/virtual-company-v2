import type { Harness } from '@mwc/shared/enums';
import { type TerminalSpec, TurnEvent, type TurnSpec } from '@mwc/shared/harness';
import { checkSpec, checkTurn } from './checks.ts';
import type {
  HarnessDriver,
  LineParser,
  PrivateDir,
  PrivateFile,
  ProcessSpec,
  TurnNotice,
  TurnTools,
} from './driver.ts';
import type { HarnessError } from './errors.ts';
import { failedResult, parseJsonLine } from './lines.ts';

export {
  FAKE_HARNESS_BIN,
  FAKE_HARNESS_SCENARIO_ENV,
  type FakeHarnessIo,
  type FakeRecord,
  type FakeScenario,
  parseScenario,
  runFakeHarness,
} from './scenario.ts';
export { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from './specs.ts';

/** What the fake's process specs hold, so a runner test points it at the fake binary. */
export interface FakeHarnessDriverOptions {
  /** Defaults to `claude_code`. */
  readonly harness?: Harness;
  /** Defaults to `fake-harness`; a runner test passes `process.execPath`. */
  readonly command?: string;
  /** Before the fake's own (`turn` or `terminal`, then `--resume <id>`); a runner test passes `[FAKE_HARNESS_BIN]`. */
  readonly args?: readonly string[];
  /** A runner test passes `{ FAKE_HARNESS_SCENARIO: <file> }`. */
  readonly env?: Readonly<Record<string, string>>;
  readonly unsetEnv?: readonly string[];
  readonly privateDir?: PrivateDir;
  readonly notices?: readonly TurnNotice[];
  /** A turn keeps stdin open for messages mid-turn (`stdinOpen`), each written as a `fakeInputLine`. */
  readonly liveInput?: boolean;
}

/** The stdin line the fake driver gives a message mid-turn. */
export const fakeInputLine = (text: string, id: string): string =>
  `${JSON.stringify({ type: 'fake_input', id, text })}\n`;

/** The file a fake turn with tools asks the runner to write in the turn's folder: how to start the MCP server. */
export const FAKE_TOOLS_FILE = 'tools.json';

/**
 * A `HarnessDriver` for other packages' tests: it runs the real spec checks, records every spec (`turns`,
 * `terminals`) and the tools a turn got (`tools`), throws queued errors (`failNext`), and builds process specs from its
 * options; with tools, a turn gets `--tools <dir>`, the tools' variables and `tools.json` (the MCP server's command) to
 * write in the turn's folder. Its parser reads lines that are `TurnEvent`s themselves (`fakeLines`), so the fake binary
 * can play any turn; with `liveInput` a turn keeps stdin open and takes messages as `fakeInputLine`s, its parser settled
 * after a result.
 */
export class FakeHarnessDriver implements HarnessDriver {
  readonly harness: Harness;
  readonly versionArgs = ['--version'] as const;
  readonly turns: TurnSpec[] = [];
  readonly terminals: TerminalSpec[] = [];
  /** The tools each turn got (undefined: none). */
  readonly tools: (TurnTools | undefined)[] = [];
  readonly #options: FakeHarnessDriverOptions;
  readonly #failures: HarnessError[] = [];

  constructor(options: FakeHarnessDriverOptions = {}) {
    this.harness = options.harness ?? 'claude_code';
    this.#options = options;
  }

  /** The next `turn` or `terminal` throws `error`. */
  failNext(error: HarnessError): void {
    this.#failures.push(error);
  }

  turn(spec: TurnSpec, tools?: TurnTools): ProcessSpec {
    this.#throwQueued();
    checkTurn(this.harness, spec);
    this.turns.push(spec);
    this.tools.push(tools);
    const opened = this.#process('turn', spec.sessionId, spec.prompt);
    const process = this.#options.liveInput ? { ...opened, stdinOpen: true } : opened;
    if (tools === undefined) return process;
    const contents = JSON.stringify({ command: tools.command, args: tools.args });
    const file: PrivateFile = { name: FAKE_TOOLS_FILE, contents, mode: 0o600 };
    return {
      ...process,
      args: [...process.args, '--tools', tools.dir],
      env: { ...process.env, ...tools.env },
      turnFiles: [file],
    };
  }

  terminal(spec: TerminalSpec): ProcessSpec {
    this.#throwQueued();
    checkSpec(this.harness, spec);
    this.terminals.push(spec);
    return this.#process('terminal', spec.sessionId, null);
  }

  parser(): LineParser {
    return new FakeLineParser(this.harness);
  }

  inputLine(text: string, id: string): string {
    return fakeInputLine(text, id);
  }

  #throwQueued(): void {
    const error = this.#failures.shift();
    if (error) throw error;
  }

  #process(mode: string, sessionId: string | null, stdin: string | null): ProcessSpec {
    const o = this.#options;
    return {
      command: o.command ?? 'fake-harness',
      args: [...(o.args ?? []), mode, ...(sessionId === null ? [] : ['--resume', sessionId])],
      env: { ...o.env },
      unsetEnv: [...(o.unsetEnv ?? [])],
      stdin,
      ...(o.privateDir ? { privateDir: o.privateDir } : {}),
      notices: [...(o.notices ?? [])],
    };
  }
}

/** Reads `TurnEvent` lines; anything else gives nothing. */
class FakeLineParser implements LineParser {
  readonly #harness: Harness;
  #resultSeen = false;
  #settled = false;

  constructor(harness: Harness) {
    this.#harness = harness;
  }

  feed(line: string): TurnEvent[] {
    const parsed = TurnEvent.safeParse(parseJsonLine(line));
    if (!parsed.success) return [];
    if (parsed.data.type === 'result') this.#resultSeen = true;
    this.#settled = parsed.data.type === 'result';
    return [parsed.data];
  }

  settled(): boolean {
    return this.#settled;
  }

  end(exitCode: number | null, stderrTail: string): TurnEvent[] {
    return this.#resultSeen ? [] : [failedResult(this.#harness, exitCode, [stderrTail])];
  }
}

/** The lines a fake binary prints for these events (a scenario's `lines` for the fake driver). */
export function fakeLines(events: readonly TurnEvent[]): string[] {
  return events.map((event) => JSON.stringify(event));
}

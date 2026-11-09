import type { Harness } from '@mwc/shared/enums';
import { type TerminalSpec, TurnEvent, type TurnSpec } from '@mwc/shared/harness';
import { checkSpec, checkTurn } from './checks.ts';
import type { HarnessDriver, LineParser, PrivateDir, ProcessSpec, TurnNotice } from './driver.ts';
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
}

/**
 * A `HarnessDriver` for other packages' tests: it runs the real spec checks, records every spec (`turns`,
 * `terminals`), throws queued errors (`failNext`), and builds process specs from its options. Its parser reads lines
 * that are `TurnEvent`s themselves (`fakeLines`), so the fake binary can play any turn.
 */
export class FakeHarnessDriver implements HarnessDriver {
  readonly harness: Harness;
  readonly versionArgs = ['--version'] as const;
  readonly turns: TurnSpec[] = [];
  readonly terminals: TerminalSpec[] = [];
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

  turn(spec: TurnSpec): ProcessSpec {
    this.#throwQueued();
    checkTurn(this.harness, spec);
    this.turns.push(spec);
    return this.#process('turn', spec.sessionId, spec.prompt);
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

  constructor(harness: Harness) {
    this.#harness = harness;
  }

  feed(line: string): TurnEvent[] {
    const parsed = TurnEvent.safeParse(parseJsonLine(line));
    if (!parsed.success) return [];
    if (parsed.data.type === 'result') this.#resultSeen = true;
    return [parsed.data];
  }

  end(exitCode: number | null, stderrTail: string): TurnEvent[] {
    return this.#resultSeen ? [] : [failedResult(this.#harness, exitCode, [stderrTail])];
  }
}

/** The lines a fake binary prints for these events (a scenario's `lines` for the fake driver). */
export function fakeLines(events: readonly TurnEvent[]): string[] {
  return events.map((event) => JSON.stringify(event));
}

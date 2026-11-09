import { fileURLToPath } from 'node:url';
import { isRecord } from './lines.ts';

/**
 * The fake harness binary for the runner's tests (docs/harness.md, "Tests"): a process that reads its stdin, prints a
 * scenario's lines, its stderr, and exits with its code, as a CLI's turn would. `node FAKE_HARNESS_BIN` runs it; the
 * scenario is the JSON file `FAKE_HARNESS_SCENARIO` names. The logic is `runFakeHarness`, tested in-process.
 */

/** A turn's output as a CLI prints it: the connectors' fixtures (`@mwc/harness-claude-code/fixtures`, …) are these. */
export interface FakeScenario {
  /** Stdout, one line each, without the newline. */
  readonly lines: readonly string[];
  readonly stderr?: string;
  readonly exitCode: number;
  /** Waited before each line, to test streaming. */
  readonly delayMs?: number;
  /** Waited after the last line before exiting, to test a stop. */
  readonly holdMs?: number;
  /** Where to write what the process got (`FakeRecord`), before it prints anything. */
  readonly record?: string;
  /** The environment variables the record keeps (only these: the rest of a test's environment stays out of files). */
  readonly recordEnv?: readonly string[];
}

/** What the fake binary got, written to the scenario's `record` file as JSON. */
export interface FakeRecord {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly env: Readonly<Record<string, string>>;
}

/** The variable that names the scenario file. */
export const FAKE_HARNESS_SCENARIO_ENV = 'FAKE_HARNESS_SCENARIO';

/** The fake binary's entry, to run with `node` (Node runs TypeScript directly). */
export const FAKE_HARNESS_BIN = fileURLToPath(new URL('../scripts/fake-harness.ts', import.meta.url));

/** The process around `runFakeHarness`, injected so tests drive it in-process. */
export interface FakeHarnessIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readStdin(): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  sleep(ms: number): Promise<void>;
}

const isWait = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0);
const isStrings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** A scenario file's contents, checked; throws a TypeError for anything else. */
export function parseScenario(text: string): FakeScenario {
  const value: unknown = JSON.parse(text);
  const ok =
    isRecord(value) &&
    isStrings(value.lines) &&
    Number.isInteger(value.exitCode) &&
    (value.stderr === undefined || typeof value.stderr === 'string') &&
    isWait(value.delayMs) &&
    isWait(value.holdMs) &&
    (value.record === undefined || typeof value.record === 'string') &&
    (value.recordEnv === undefined || isStrings(value.recordEnv));
  if (!ok) throw new TypeError('Not a fake harness scenario');
  return value as unknown as FakeScenario;
}

/** Plays the scenario `FAKE_HARNESS_SCENARIO` names; resolves to the exit code (2 when there is no usable scenario). */
export async function runFakeHarness(io: FakeHarnessIo): Promise<number> {
  const path = io.env[FAKE_HARNESS_SCENARIO_ENV];
  let scenario: FakeScenario;
  try {
    if (path === undefined || path === '') throw new TypeError(`${FAKE_HARNESS_SCENARIO_ENV} is not set`);
    scenario = parseScenario(await io.readFile(path));
  } catch (error) {
    io.writeStderr(`fake-harness: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const stdin = await io.readStdin();
  if (scenario.record !== undefined)
    await io.writeFile(scenario.record, JSON.stringify(recordOf(io, stdin, scenario)));
  for (const line of scenario.lines) {
    if (scenario.delayMs) await io.sleep(scenario.delayMs);
    io.writeStdout(`${line}\n`);
  }
  if (scenario.stderr) io.writeStderr(scenario.stderr);
  if (scenario.holdMs) await io.sleep(scenario.holdMs);
  return scenario.exitCode;
}

function recordOf(io: FakeHarnessIo, stdin: string, scenario: FakeScenario): FakeRecord {
  const env: Record<string, string> = {};
  for (const name of scenario.recordEnv ?? []) {
    const value = io.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { argv: [...io.argv], cwd: io.cwd, stdin, env };
}

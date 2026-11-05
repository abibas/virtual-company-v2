/**
 * The sign-in tests' doubles: a `LoginHelper` whose sandboxes replay a script of CLI output (from `cli.ts`) and answer
 * what is typed into them, and timers a test fires by hand. Nothing starts a process or a container.
 */
import type { SignInTimers } from '../../../src/modules/credentials/service/sign-in/context.ts';
import {
  type LoginCommand,
  type LoginHelper,
  LoginHelperError,
  type LoginSandbox,
  type SandboxExit,
} from '../../../src/platform/login-helper/port.ts';
import { CLAUDE_FILES, CLAUDE_OUTPUT, CODEX_FILES, CODEX_OUTPUT } from './cli.ts';

/** A sandbox a test drives: it emits output and exits when told, and records what was typed and read. */
export class FakeSandbox implements LoginSandbox {
  readonly written: string[] = [];
  readonly reads: string[] = [];
  kills = 0;
  #output: ((chunk: string) => void)[] = [];
  #exit: ((exit: SandboxExit) => void)[] = [];
  #files: Record<string, string>;
  #onWrite: ((sandbox: FakeSandbox, input: string) => void) | undefined;
  /** Holds every file read until it settles: a test's way to catch a sign-in while it stores. */
  hold: Promise<void> | undefined;

  constructor(files: Record<string, string>, onWrite?: (sandbox: FakeSandbox, input: string) => void) {
    this.#files = { ...files };
    this.#onWrite = onWrite;
  }

  emit(...chunks: string[]): void {
    for (const chunk of chunks) for (const listener of this.#output) listener(chunk);
  }

  exit(code: number | null, error?: string): void {
    const value: SandboxExit = error === undefined ? { code } : { code, error };
    for (const listener of this.#exit.splice(0)) listener(value);
  }

  setFile(path: string, text: string | undefined): void {
    if (text === undefined) delete this.#files[path];
    else this.#files[path] = text;
  }

  onOutput(listener: (chunk: string) => void): void {
    this.#output.push(listener);
  }

  onExit(listener: (exit: SandboxExit) => void): void {
    this.#exit.push(listener);
  }

  write(input: string): void {
    this.written.push(input);
    this.#onWrite?.(this, input);
  }

  async readFile(path: string): Promise<string | undefined> {
    this.reads.push(path);
    await this.hold;
    return this.#files[path];
  }

  async kill(): Promise<void> {
    this.kills += 1;
  }
}

/** How a fake sandbox behaves: what it prints at once, its files, and how it answers what is typed. */
export interface SandboxScript {
  readonly output?: readonly string[];
  readonly files?: Record<string, string>;
  readonly onWrite?: (sandbox: FakeSandbox, input: string) => void;
}

/** Claude's login: the address and the prompt; a typed code ends it with success (or with `refused`). */
export const claudeScript = (answer: 'accept' | 'refuse' | 'silent' = 'accept'): SandboxScript => ({
  output: [CLAUDE_OUTPUT.opening, CLAUDE_OUTPUT.address, CLAUDE_OUTPUT.prompt],
  files: CLAUDE_FILES,
  onWrite: (sandbox) => {
    if (answer === 'accept') {
      sandbox.emit(CLAUDE_OUTPUT.success);
      sandbox.exit(0);
    } else if (answer === 'refuse') {
      sandbox.emit(CLAUDE_OUTPUT.refused);
      sandbox.exit(1);
    }
  },
});

/** OpenAI's device login: the address and the one-time code; the test ends it (`sandbox.exit(0)` once approved). */
export const codexScript = (): SandboxScript => ({
  output: [CODEX_OUTPUT.welcome, CODEX_OUTPUT.steps, CODEX_OUTPUT.code],
  files: CODEX_FILES,
});

/**
 * A `LoginHelper` that hands out scripted sandboxes. `start` resolves after the test's `gate` (when set), and fails
 * with `failNext` once; each sandbox replays its script's output on the tick after it is returned.
 */
export class FakeLoginHelper implements LoginHelper {
  readonly mode = 'docker' as const;
  readonly commands: LoginCommand[] = [];
  readonly sandboxes: FakeSandbox[] = [];
  script: SandboxScript = claudeScript();
  failNext: Error | undefined;
  gate: Promise<void> | undefined;

  async start(command: LoginCommand): Promise<LoginSandbox> {
    this.commands.push(command);
    await this.gate;
    const failure = this.failNext;
    this.failNext = undefined;
    if (failure !== undefined) throw failure;
    const sandbox = new FakeSandbox(this.script.files ?? {}, this.script.onWrite);
    this.sandboxes.push(sandbox);
    const output = this.script.output ?? [];
    setImmediate(() => sandbox.emit(...output));
    return sandbox;
  }

  /** The newest sandbox. */
  get last(): FakeSandbox {
    const sandbox = this.sandboxes.at(-1);
    if (sandbox === undefined) throw new Error('no sandbox was started');
    return sandbox;
  }
}

export const helperError = (message: string) => new LoginHelperError(message);

/** Timers that fire only when a test says so. */
export class ManualTimers implements SignInTimers {
  readonly #pending = new Map<number, { readonly callback: () => void; readonly ms: number }>();
  #next = 1;

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.#next++;
    this.#pending.set(id, { callback, ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#pending.delete(handle as number);
  }

  /** The delays of the timers still set. */
  get pending(): number[] {
    return [...this.#pending.values()].map((timer) => timer.ms);
  }

  /** Fires every timer set for `ms`. */
  fire(ms: number): void {
    for (const [id, timer] of [...this.#pending]) {
      if (timer.ms !== ms) continue;
      this.#pending.delete(id);
      timer.callback();
    }
  }
}

/** Lets the sandbox's output (sent on the next tick) and pending promises settle. */
export const settle = async (rounds = 5): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** Waits (a tick at a time, at most 2 seconds) until `check` holds, e.g. until a stored sign-in is done. */
export async function until(check: () => boolean | Promise<boolean>, what = 'the condition'): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

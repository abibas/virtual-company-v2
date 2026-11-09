import { randomUUID } from 'node:crypto';
import type { LineParser, ProcessSpec } from '@mwc/harness-core';
import type { AskQuestions, TurnEvent } from '@mwc/shared/harness';
import {
  TURN_STOP_KILL_MS,
  TURN_STOP_TERM_MS,
  type TurnEnd,
  type TurnRunnerFrame,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { ChildLike, KillGroup, Spawn } from '../system/process.ts';
import type { Timers } from '../system/time.ts';
import type { AskBridge } from './ask/bridge.ts';
import { ASK_REPLY, type AskReply } from './ask/tool.ts';
import { EventBatcher } from './batch.ts';
import { TurnInput } from './input.ts';
import { LineReader, TailBuffer } from './lines.ts';
import { type PrivateLease, releaseLogin } from './private-dir.ts';

/**
 * One chat turn's process (docs/harness.md, "How a turn runs"): started from the driver's process spec in the agent's
 * folder as its own process group, the prompt written to its stdin and closed (or kept open for the person's messages
 * while it runs, `input.ts`, S5.2 step 6), its stdout read line by line through the driver's parser into events (the driver's notices first), batched to the link, and the end of its stderr kept. When
 * it ends: the parser's last events, the private folder released (a Codex login it rewrote goes back as `authJson`),
 * then `turn.end` once. `stop` walks the ladder: SIGINT to the group, SIGTERM 5 s later, SIGKILL 10 s after the SIGINT.
 * With the runner's tools, a question the agent asks through its bridge goes out as `turn.question`, numbered among the
 * events (those before it sent first), and the agent is told to end its turn; the bridge closes when the process ends.
 */

/** Why the runner ended a turn: a person stopped it, the runner stops, or the link dropped (nothing gets through). */
export type StopReason = 'stopped' | 'runner_stopping' | 'link_lost';

export interface TurnDeps {
  readonly spawn: Spawn;
  readonly killGroup: KillGroup;
  readonly timers: Timers;
  readonly log: Log;
  /** Sends a frame on the link; false when it is down. */
  send(frame: TurnRunnerFrame): boolean;
  /** Called once, right after its `turn.end` was sent. */
  ended(turnId: string): void;
}

/** What starts the process. */
export interface TurnLaunch {
  readonly process: ProcessSpec;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly parser: LineParser;
  readonly lease: PrivateLease | undefined;
  /** The turn's question socket, when the runner offers its tools. */
  readonly bridge?: AskBridge | undefined;
  /** The driver's line for a message mid-turn, when the process keeps stdin open (`ProcessSpec.stdinOpen`). */
  readonly inputLine?: ((text: string, id: string) => string) | undefined;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Why a question was not shown: the turn is ending, or the link is down. */
export const ASK_ENDING = 'The question was not shown: this turn is ending.';
export const ASK_OFFLINE = 'The question was not shown: the runner has lost its link to the server.';

/** The log line of a login a harness rewrote into something that is not one (its text is never logged). */
export const INVALID_LOGIN = 'the harness rewrote its login into something that is not one; not sent back';

export class TurnProcess {
  readonly turnId: string;
  /** Resolves once its `turn.end` was sent. */
  readonly done: Promise<void>;
  readonly #deps: TurnDeps;
  readonly #launch: TurnLaunch;
  readonly #batcher: EventBatcher;
  readonly #stdout = new LineReader();
  readonly #stderr = new TailBuffer();
  readonly #resolve: () => void;
  #child: ChildLike | undefined;
  #input: TurnInput | undefined;
  #result: Extract<TurnEvent, { type: 'result' }> | undefined;
  #stopped: StopReason | undefined;
  #timers: unknown[] = [];
  #ended = false;

  constructor(turnId: string, launch: TurnLaunch, deps: TurnDeps) {
    this.turnId = turnId;
    this.#launch = launch;
    this.#deps = deps;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.done = promise;
    this.#resolve = resolve;
    this.#batcher = new EventBatcher({
      timers: deps.timers,
      send: (events) => deps.send({ type: 'turn.events', turnId, events: [...events] }),
    });
    launch.bridge?.bind((questions) => this.#ask(questions));
  }

  /** Starts the process; throws when it cannot even be spawned (the caller refuses the turn). */
  start(): void {
    const { process, cwd, env } = this.#launch;
    const child = this.#deps.spawn(process.command, process.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      cwd,
      env,
    });
    this.#child = child;
    const { parser, inputLine } = this.#launch;
    this.#input = new TurnInput({
      turnId: this.turnId,
      stdin: child.stdin,
      line: inputLine,
      open: process.stdinOpen === true,
      settled: () => parser.settled?.() ?? true,
      timers: this.#deps.timers,
      log: this.#deps.log,
    });
    this.#events(process.notices);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      for (const line of this.#stdout.push(chunk)) this.#line(line);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => this.#stderr.push(chunk));
    child.once('error', (error) => this.#finish(null, `spawn_failed: ${messageOf(error)}`));
    child.once('close', (code) => this.#finish(code));
    this.#input.begin(process.stdin);
    this.#deps.log.info('turn started', { turnId: this.turnId, command: process.command, pid: child.pid });
  }

  /**
   * The person's message for the running turn (`turn.input`): written to a harness that takes messages mid-turn; false
   * when it does not or no longer does (its result came, it is stopping or ended), so the server starts it next.
   */
  input(inputId: string, text: string): boolean {
    // Only a started turn is live: its input is there.
    const input = this.#input as TurnInput;
    const taken = !this.#ended && this.#stopped === undefined && input.send(inputId, text);
    if (!taken) this.#deps.log.info('turn.input not taken; dropped', { turnId: this.turnId, inputId });
    return taken;
  }

  /** Ends it by the stop ladder (once); `reason` goes in its `turn.end`. */
  stop(reason: StopReason): Promise<void> {
    if (this.#stopped !== undefined || this.#ended) return this.done;
    this.#stopped = reason;
    const pid = this.#child?.pid;
    if (pid === undefined) return this.done;
    (this.#input as TurnInput).close('stopping');
    const { killGroup, timers } = this.#deps;
    killGroup(pid, 'SIGINT');
    this.#timers = [
      timers.setTimeout(() => killGroup(pid, 'SIGTERM'), TURN_STOP_TERM_MS),
      timers.setTimeout(() => killGroup(pid, 'SIGKILL'), TURN_STOP_KILL_MS),
    ];
    return this.done;
  }

  /** The agent asked the person: the events so far, then the question with the next number. */
  #ask(questions: AskQuestions): AskReply {
    if (this.#ended || this.#stopped !== undefined) return { ok: false, error: ASK_ENDING };
    this.#batcher.flush();
    const seq = this.#batcher.reserve();
    const questionId = randomUUID();
    if (!this.#deps.send({ type: 'turn.question', turnId: this.turnId, seq, questionId, questions })) {
      return { ok: false, error: ASK_OFFLINE };
    }
    this.#deps.log.info('turn asked the person', {
      turnId: this.turnId,
      questionId,
      questions: questions.length,
    });
    return { ok: true, text: ASK_REPLY };
  }

  /** One line of stdout through the parser, the echoes of this turn's messages kept (`input.ts`). */
  #line(line: string): void {
    const input = this.#input as TurnInput;
    input.activity();
    this.#events(input.filter(this.#launch.parser.feed(line)));
  }

  #events(events: readonly TurnEvent[]): void {
    for (const event of events) if (event.type === 'result') this.#result = event;
    this.#batcher.push(events);
  }

  /** The process ended (or never started): its last events, the private folder released, then `turn.end`. */
  #finish(code: number | null, failure?: string): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#launch.bridge?.close();
    for (const timer of this.#timers) this.#deps.timers.clearTimeout(timer);
    const last = this.#stdout.end();
    if (last !== undefined) this.#line(last);
    (this.#input as TurnInput).close();
    this.#events(this.#launch.parser.end(code, failure ?? this.#stderr.text()));
    this.#batcher.flush();
    const end = this.#end(code, failure);
    this.#deps.send(end);
    const { ok, exitCode, error } = end;
    this.#deps.log.info('turn ended', {
      turnId: this.turnId,
      ok,
      exitCode,
      error,
      events: this.#batcher.lastSeq,
    });
    this.#resolve();
    this.#deps.ended(this.turnId);
  }

  #end(code: number | null, failure: string | undefined): TurnEnd {
    const error = failure ?? this.#stopped;
    const ok = error === undefined && this.#result?.ok === true;
    const authJson = this.#rewrittenLogin();
    return {
      type: 'turn.end',
      turnId: this.turnId,
      ok,
      exitCode: code,
      ...(error === undefined ? {} : { error }),
      ...(authJson === undefined ? {} : { authJson }),
    };
  }

  /** The Codex login the process rewrote, when it is still a login the server can take; never logged. */
  #rewrittenLogin(): string | undefined {
    const login = releaseLogin(this.#launch.lease);
    if (login !== 'invalid') return login;
    this.#deps.log.warn(INVALID_LOGIN, { turnId: this.turnId });
    return undefined;
  }
}

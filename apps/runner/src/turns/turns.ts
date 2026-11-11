import type { HarnessDriver, ProcessSpec } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import type {
  HarnessVersions,
  TurnRunnerFrame,
  TurnServerFrame,
  TurnStart,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { KillGroup, Spawn } from '../system/process.ts';
import type { Timers } from '../system/time.ts';
import { ArtifactCollector, type ArtifactFs } from './artifacts/collect.ts';
import { type AskBridge, type AskHost, turnTools } from './ask/bridge.ts';
import { type Env, processEnv } from './env.ts';
import { type PrivateDirs, type PrivateLease, withPrivateDir } from './private-dir.ts';
import { type StopReason, type TurnLaunch, TurnProcess } from './turn.ts';

/**
 * The machine's chat turns (docs/harness.md, "How a turn runs"): `turn.start` runs one turn of a harness as a process
 * (`turn.ts`), at most `slots` at once, `turn.input` gives a running one the person's message (S5.2 step 6; dropped
 * when it takes none), and `turn.stop` stops it. A start the runner will not carry out is answered at
 * once with `turn.end {ok: false, exitCode: null, error}`: `unsupported` (no such harness here), `busy` (every slot
 * taken), `home_missing` (the agent's folder is not on this machine), `invalid_spec: …` (the driver refused the spec),
 * `spawn_failed: …`, `runner_stopping`. A repeated start of a live turn and a stop of an unknown one are ignored. Live
 * turns count for the runner's own hold; they all end when the link drops (nothing can reach them then) and when the
 * runner stops (`runner_stopping`, before the link closes). A runner that offers its tools opens each turn's question
 * socket first and hands the driver its MCP server (a turn whose socket cannot open runs without it, logged). A task
 * step's turn (S5.3b) gets its outputs folder made and noted before its process starts (`artifacts/collect.ts`).
 */

/** What a runner that runs harnesses has: the drivers of the CLIs it found, their versions, and what a turn needs. */
export interface HarnessHost {
  /** The drivers of the harnesses whose CLI is installed here. */
  readonly drivers: Partial<Record<Harness, HarnessDriver>>;
  /** Each CLI's version (`caps.harnesses`), null for a missing one. */
  readonly versions: HarnessVersions;
  /** The runner's environment, which a process gets less `MWC_*` and the driver's `unsetEnv`. */
  readonly env: Env;
  /** The private folders, shared by turns and terminals. */
  readonly dirs: PrivateDirs;
  /** Whether the agent's folder is there. */
  isDirectory(path: string): boolean;
  /** The runner's tools (its MCP server and each turn's question socket); left out, turns run without them. */
  readonly ask?: AskHost;
  /** A task step's outputs folder (S5.3b); left out, a turn's `artifacts` is passed over and nothing is collected. */
  readonly artifacts?: ArtifactFs;
  /**
   * Looks for a harness that has no driver again (no process unless its CLI is found now, then its `--version`); true
   * once it has one. Left out: a missing harness stays missing.
   */
  findAgain?(harness: Harness): Promise<boolean>;
}

export interface TurnsDeps {
  /** Undefined when this runner runs no harness: every start is `unsupported`. */
  readonly host: HarnessHost | undefined;
  /** How a turn's process starts and stops; without them every start is `unsupported` too. */
  readonly processes: { readonly spawn: Spawn; readonly killGroup: KillGroup } | undefined;
  /** How many turns may run at once (the configuration's slots). */
  slots(): number;
  readonly timers: Timers;
  readonly log: Log;
  send(frame: TurnRunnerFrame): boolean;
  /** How many turns are live, after each change (the hold counts them). */
  count(live: number): void;
}

/** A start refused: the code and words, or a launch. */
type Prepared =
  | { readonly refused: string }
  | { readonly launch: TurnLaunch; readonly processes: NonNullable<TurnsDeps['processes']> };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Turns {
  readonly #deps: TurnsDeps;
  readonly #live = new Map<string, TurnProcess>();
  /** Turns waiting for their harness to be looked for again, with why they were stopped meanwhile. */
  readonly #searching = new Map<string, StopReason | undefined>();
  #stopping = false;

  constructor(deps: TurnsDeps) {
    this.#deps = deps;
  }

  /** How many turns are live. */
  get live(): number {
    return this.#live.size;
  }

  handle(frame: TurnServerFrame): void {
    if (frame.type === 'turn.start') {
      this.#start(frame);
      return;
    }
    const turn = this.#live.get(frame.turnId);
    if (frame.type === 'turn.input') {
      if (turn === undefined)
        this.#deps.log.info('turn.input for no live turn; dropped', { turnId: frame.turnId });
      else turn.input(frame.inputId, frame.text);
      return;
    }
    if (this.#searching.has(frame.turnId)) this.#searching.set(frame.turnId, 'stopped');
    else if (turn === undefined)
      this.#deps.log.info('turn.stop for no live turn; ignored', { turnId: frame.turnId });
    else void turn.stop('stopped');
  }

  /** Ends every live turn by the stop ladder, `reason` in each `turn.end`; resolves once they ended. */
  async stopAll(reason: StopReason): Promise<void> {
    for (const [turnId, stopped] of this.#searching) this.#searching.set(turnId, stopped ?? reason);
    await Promise.all([...this.#live.values()].map((turn) => turn.stop(reason)));
  }

  /** The runner stops: no new turn, and every live one ended with `runner_stopping`. */
  async stop(): Promise<void> {
    this.#stopping = true;
    await this.stopAll('runner_stopping');
  }

  #start(frame: TurnStart): void {
    const { turnId } = frame;
    if (this.#live.has(turnId) || this.#searching.has(turnId)) {
      this.#deps.log.warn('a second turn.start for a live turn; ignored', { turnId });
      return;
    }
    const { host, processes } = this.#deps;
    const { harness } = frame.spec;
    if (host?.findAgain && processes && !this.#stopping && host.drivers[harness] === undefined) {
      // A harness missing at start may have been installed since: look again before refusing it.
      this.#searching.set(turnId, undefined);
      void host.findAgain(harness).then(() => {
        const stopped = this.#searching.get(turnId);
        this.#searching.delete(turnId);
        if (stopped === undefined) this.#launch(frame);
        else this.#refuse(turnId, stopped);
      });
      return;
    }
    this.#launch(frame);
  }

  #launch(frame: TurnStart): void {
    const { turnId } = frame;
    const prepared = this.#prepare(frame);
    if ('refused' in prepared) {
      this.#refuse(turnId, prepared.refused);
      return;
    }
    const turn = new TurnProcess(turnId, prepared.launch, {
      ...prepared.processes,
      timers: this.#deps.timers,
      log: this.#deps.log,
      send: (sent) => this.#deps.send(sent),
      ended: (id) => {
        this.#live.delete(id);
        this.#deps.count(this.#live.size);
      },
    });
    try {
      turn.start();
    } catch (error) {
      prepared.launch.lease?.release();
      prepared.launch.bridge?.close();
      this.#refuse(turnId, `spawn_failed: ${messageOf(error)}`);
      return;
    }
    this.#live.set(turnId, turn);
    this.#deps.count(this.#live.size);
  }

  /** The checks in order, then the driver's spec, the private folder and the environment. */
  #prepare(frame: TurnStart): Prepared {
    const { spec } = frame;
    const { host, processes } = this.#deps;
    const driver = host?.drivers[spec.harness];
    if (this.#stopping) return { refused: 'runner_stopping' };
    if (host === undefined || processes === undefined || driver === undefined)
      return { refused: 'unsupported' };
    if (this.#live.size >= this.#deps.slots()) return { refused: 'busy' };
    if (!host.isDirectory(spec.cwd)) return { refused: 'home_missing' };
    const bridge = this.#openBridge(host, frame.turnId);
    let built: ProcessSpec;
    try {
      built = driver.turn(spec, bridge && host.ask && turnTools(host.ask, bridge));
    } catch (error) {
      bridge?.close();
      return { refused: `invalid_spec: ${messageOf(error)}` };
    }
    let lease: PrivateLease | undefined;
    try {
      for (const file of built.turnFiles ?? []) bridge?.write(file);
      lease = built.privateDir && host.dirs.acquire(built.privateDir, spec.harness, spec.cwd);
    } catch (error) {
      bridge?.close();
      return { refused: `spawn_failed: ${messageOf(error)}` };
    }
    const { process, env: extra } = withPrivateDir(built, lease);
    const env = processEnv(host.env, process, extra);
    const inputLine = process.stdinOpen ? driver.inputLine?.bind(driver) : undefined;
    const parser = driver.parser(lease === undefined ? {} : { privateDir: lease.path });
    const artifacts = this.#openArtifacts(host, frame);
    const launch = { process, cwd: spec.cwd, env, parser, lease, bridge, inputLine, artifacts };
    return { launch, processes };
  }

  /** A task step's outputs folder, made and noted before the process; none without one (or when it cannot be used). */
  #openArtifacts(host: HarnessHost, frame: TurnStart): ArtifactCollector | undefined {
    const dir = frame.spec.artifacts?.dir;
    if (dir === undefined || host.artifacts === undefined) return undefined;
    return ArtifactCollector.open(host.artifacts, frame.spec.cwd, dir, this.#deps.log);
  }

  /** The turn's question socket, when the runner offers its tools; a turn whose socket cannot open runs without it. */
  #openBridge(host: HarnessHost, turnId: string): AskBridge | undefined {
    if (host.ask === undefined) return undefined;
    try {
      return host.ask.open();
    } catch (error) {
      this.#deps.log.warn('this turn runs without the question tool', { turnId, error: messageOf(error) });
      return undefined;
    }
  }

  #refuse(turnId: string, error: string): void {
    this.#deps.log.info('turn refused', { turnId, error });
    this.#deps.send({ type: 'turn.end', turnId, ok: false, exitCode: null, error: error.slice(0, 2000) });
  }
}

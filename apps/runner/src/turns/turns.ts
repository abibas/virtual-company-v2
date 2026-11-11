import type { HarnessDriver } from '@mwc/harness-core';
import type { Harness } from '@mwc/shared/enums';
import type {
  HarnessVersions,
  HeldTurn,
  ServerHello,
  TurnResume,
  TurnRunnerFrame,
  TurnServerFrame,
  TurnStart,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { KillGroup, Spawn } from '../system/process.ts';
import type { Clock, Timers } from '../system/time.ts';
import type { ArtifactFs } from './artifacts/collect.ts';
import type { AskHost } from './ask/bridge.ts';
import type { Env } from './env.ts';
import { type Prepared, prepareTurn, takeBackParts } from './prepare.ts';
import type { PrivateDirs } from './private-dir.ts';
import type { ReadAt } from './runs/journal.ts';
import type { KeeperCommand } from './runs/kept.ts';
import { type FoundRun, findRuns } from './runs/reattach.ts';
import { type TurnParts, TurnProcess } from './turn.ts';

/**
 * The machine's chat turns (docs/harness.md, "How a turn runs" and "Surviving restarts"): `turn.start` runs one turn of
 * a harness through its keeper in a run folder (`turn.ts`), at most `slots` at once, `turn.input` gives a running one
 * the person's message (S5.2 step 6; dropped when it takes none), and `turn.stop` stops it. A start the runner will not
 * carry out is answered at once with `turn.end {ok: false, exitCode: null, error}`: `unsupported` (no such harness
 * here, or no keeper), `busy` (every slot taken), `home_missing` (the agent's folder is not on this machine),
 * `invalid_spec: …` (the driver refused the spec), `spawn_failed: …`, `runner_stopping`. A repeated start of a live turn
 * and a stop of an unknown one are ignored. Since S5.4 turns outlive the link and the runner: a dropped link only holds
 * their frames back, the runner stopping lets go of them (`stop`), and a runner starting takes back the ones on its disk
 * (`reattach`), names them in its hello (`held`) and resumes each where the server's `turn.resume` says, or forgets it
 * (stopped, its folder removed) when the server no longer has it; `turn.ack` removes an ended turn's folder. Live turns
 * count for the runner's own hold. A runner that offers its tools opens each turn's question socket first (a turn whose
 * socket cannot open runs without it, logged), and its MCP server offers the agents' tools the spec names (S6a), whose
 * answers come back as `turn.tool.result`; a task step's turn (S5.3b) gets its outputs folder made and noted first.
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
  /** Where the turns' run folders are (`<state>/runs`, S5.4). */
  readonly runs: string;
  /** Reads a file from an offset (a turn's output). */
  readonly readAt: ReadAt;
  /** How a turn's keeper starts (`<node> <runner.mjs> keep`); without it no turn runs (`unsupported`). */
  readonly keeper?: KeeperCommand;
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
  readonly clock: Clock;
  readonly timers: Timers;
  readonly log: Log;
  send(frame: TurnRunnerFrame): boolean;
  /** How many turns are live, after each change (the hold counts them). */
  count(live: number): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Turns {
  readonly #deps: TurnsDeps;
  readonly #turns = new Map<string, TurnProcess>();
  /** Turns waiting for their harness to be looked for again, and whether they were stopped meanwhile. */
  readonly #searching = new Map<string, boolean>();
  #stopping = false;

  constructor(deps: TurnsDeps) {
    this.#deps = deps;
  }

  /** How many turns' processes run. */
  get live(): number {
    let live = 0;
    for (const turn of this.#turns.values()) if (turn.running) live++;
    return live;
  }

  /** The turns it holds, for its hello: live ones and ended ones whose end was not acknowledged. */
  held(): HeldTurn[] {
    return [...this.#turns.values()].map((turn) => turn.held);
  }

  handle(frame: TurnServerFrame): void {
    if (frame.type === 'turn.start') this.#start(frame);
    else if (frame.type === 'turn.resume') this.#resume(frame);
    else if (frame.type === 'turn.ack') this.#turns.get(frame.turnId)?.acknowledged();
    else if (frame.type === 'turn.tool.result') {
      if (this.#turns.get(frame.turnId)?.toolResult(frame) !== true)
        this.#deps.log.info('turn.tool.result for no waiting call; dropped', { turnId: frame.turnId });
    } else this.#steer(frame);
  }

  /** `turn.input` and `turn.stop` of a turn it holds (or one whose harness it is looking for again). */
  #steer(frame: Extract<TurnServerFrame, { type: 'turn.input' | 'turn.stop' }>): void {
    const turn = this.#turns.get(frame.turnId);
    if (frame.type === 'turn.input') {
      if (turn === undefined)
        this.#deps.log.info('turn.input for no live turn; dropped', { turnId: frame.turnId });
      else turn.input(frame.inputId, frame.text);
      return;
    }
    if (this.#searching.has(frame.turnId)) this.#searching.set(frame.turnId, true);
    else if (turn === undefined)
      this.#deps.log.info('turn.stop for no live turn; ignored', { turnId: frame.turnId });
    else void turn.stop();
  }

  /** The link dropped: every turn runs on, its frames held back until the server says where to resume. */
  linkDown(): void {
    for (const turn of this.#turns.values()) turn.detach();
  }

  /** A new link's `server.hello`: an older server, which takes no turn back, has them all forgotten. */
  connected(hello: ServerHello): void {
    if (hello.resume === true) return;
    for (const turn of this.#turns.values()) turn.forget();
  }

  /** Takes back the turns on its disk (before its first hello); resolves once each is known. */
  async reattach(): Promise<void> {
    const { host, processes, timers, log } = this.#deps;
    if (host === undefined || processes === undefined) return;
    for (const run of await findRuns(host.runs, { timers, now: this.#deps.clock.now(), log })) {
      this.#takeBack(host, run);
    }
    this.#deps.count(this.live);
  }

  /** The runner stops: no new turn, and every turn left running for the next runner. */
  async stop(): Promise<void> {
    this.#stopping = true;
    for (const turn of this.#turns.values()) turn.release();
    this.#turns.clear();
  }

  #resume(frame: TurnResume): void {
    for (const { turnId, lastSeq } of frame.turns) {
      const turn = this.#turns.get(turnId);
      if (turn === undefined) continue;
      if (lastSeq === null) turn.forget();
      else turn.attach(lastSeq);
    }
  }

  #start(frame: TurnStart): void {
    const { turnId } = frame;
    if (this.#turns.has(turnId) || this.#searching.has(turnId)) {
      this.#deps.log.warn('a second turn.start for a live turn; ignored', { turnId });
      return;
    }
    const { host, processes } = this.#deps;
    const { harness } = frame.spec;
    if (host?.findAgain && processes && !this.#stopping && host.drivers[harness] === undefined) {
      // A harness missing at start may have been installed since: look again before refusing it.
      this.#searching.set(turnId, false);
      void host.findAgain(harness).then(() => {
        const stopped = this.#searching.get(turnId);
        this.#searching.delete(turnId);
        if (stopped) this.#refuse(turnId, 'stopped');
        else this.#launch(frame);
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
    const { parts, launch } = prepared;
    const turn = this.#turn(turnId, parts);
    try {
      turn.start(launch);
    } catch (error) {
      parts.lease?.release();
      parts.bridge?.close();
      parts.folder.remove();
      this.#refuse(turnId, `spawn_failed: ${messageOf(error)}`);
      return;
    }
    this.#turns.set(turnId, turn);
    this.#deps.count(this.live);
  }

  #turn(turnId: string, parts: TurnParts): TurnProcess {
    const processes = this.#deps.processes as NonNullable<TurnsDeps['processes']>;
    const host = this.#deps.host as HarnessHost;
    return new TurnProcess(turnId, parts, {
      ...processes,
      timers: this.#deps.timers,
      log: this.#deps.log,
      readAt: host.readAt,
      send: (sent) => this.#deps.send(sent),
      ended: () => this.#deps.count(this.live),
      done: (id) => {
        this.#turns.delete(id);
        this.#deps.count(this.live);
      },
    });
  }

  /** The runner's checks in order, then the driver's spec, the folders and the environment (`prepare.ts`). */
  #prepare(frame: TurnStart): Prepared {
    const { host, processes } = this.#deps;
    if (this.#stopping) return { refused: 'runner_stopping' };
    const keeper = host?.keeper;
    if (
      host === undefined ||
      keeper === undefined ||
      processes === undefined ||
      !host.drivers[frame.spec.harness]
    )
      return { refused: 'unsupported' };
    if (this.live >= this.#deps.slots()) return { refused: 'busy' };
    return prepareTurn(host, keeper, frame, this.#deps.clock.now(), this.#deps.log);
  }

  /** A turn found on the disk at start, taken back (`prepare.ts`); one of a harness no longer here is left running. */
  #takeBack(host: HarnessHost, run: FoundRun): void {
    const parts = takeBackParts(host, run, this.#deps.log);
    if (parts === undefined) {
      this.#deps.log.warn('a turn of a harness this runner no longer has; left running', {
        turnId: run.meta.turnId,
      });
      run.kept?.release();
      return;
    }
    const turn = this.#turn(run.meta.turnId, parts);
    this.#turns.set(run.meta.turnId, turn);
    turn.resume(run.meta, run.kept);
  }

  #refuse(turnId: string, error: string): void {
    this.#deps.log.info('turn refused', { turnId, error });
    this.#deps.send({ type: 'turn.end', turnId, ok: false, exitCode: null, error: error.slice(0, 2000) });
  }
}

import {
  type CmdAck,
  isTerminalFrame,
  isTurnFrame,
  type PowerResult,
  type RunnerFrame,
  type RunnerUpdate,
  type RunnerUpdateResult,
  type ServerFrame,
  type TerminalServerFrame,
  type TunnelSpec,
  type TurnServerFrame,
} from '@mwc/shared/runner-protocol';
import { z } from 'zod';
import { type PowerExecutor, runPowerCommand } from '../power/executor.ts';
import type { Log } from '../system/log.ts';

/**
 * The server's commands (docs/runner-protocol.md, "Semantics"): every frame with a `cmdId` is answered once, with
 * `cmd.ack` (`power.command` with `power.result`, `runner.update` with `runner.update.result`), and a repeat of a
 * `cmdId` already run gets the same answer again without running it again. S4.3 carries out `machine.hold`,
 * `power.command` (through the injected executor), `key.rotate` and `runner.drain`, and the self-update its
 * `runner.update`; the run commands are refused until S5, and offers are declined. `tunnel.set` is no
 * command (it has no `cmdId`): the controller's tunnels take it as it comes; nor are the terminal and turn frames,
 * which go to the terminals and the turns, whose answers are their own frames.
 */

/** How many answered commands are remembered for repeats. */
export const REMEMBERED_COMMANDS = 1000;

/** The refusal of a run command before the runner runs anything (S5). */
export const NO_RUNS = 'this runner does not run jobs yet';

export interface CommandDeps {
  /** `machine.hold`: resolves once the driver applied it. */
  setServerHold(until: number | null): Promise<void>;
  readonly power: PowerExecutor;
  /** `key.rotate`: saves the new key (0600) before the ack; the next connection uses it. */
  saveKey(key: string): void | Promise<void>;
  /** `runner.drain`: no new runs until the runner restarts. */
  drain(): void;
  /** `tunnel.set`: the tunnels the server wants this controller to hold now. */
  setTunnels(tunnels: readonly TunnelSpec[]): void;
  /** `terminal.*`: for the machine's terminals. */
  terminal(frame: TerminalServerFrame): void;
  /** `turn.*`: for the machine's chat turns. */
  turn(frame: TurnServerFrame): void;
  /** `runner.update`: the self-update's answer (it never throws). */
  update(frame: RunnerUpdate): Promise<RunnerUpdateResult>;
  readonly log: Log;
}

type Answer = CmdAck | PowerResult | RunnerUpdateResult;

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

const ack = (cmdId: string, error?: string): CmdAck =>
  error === undefined ? { type: 'cmd.ack', cmdId, ok: true } : { type: 'cmd.ack', cmdId, ok: false, error };

const messageOf = (error: unknown) =>
  (error instanceof Error && error.message ? error.message : 'the command failed').slice(0, 2000);

export class Commands {
  readonly #deps: CommandDeps;
  readonly #answered = new Map<string, Answer>();
  readonly #running = new Set<string>();

  constructor(deps: CommandDeps) {
    this.#deps = deps;
  }

  /** The answers to a server frame (none for frames that are not commands). */
  async handle(frame: ServerFrame): Promise<RunnerFrame[]> {
    if (frame.type === 'job.offer') {
      return [{ type: 'job.decline', id: frame.id, runId: frame.runId, reason: NO_RUNS }];
    }
    if (frame.type === 'tunnel.set') {
      this.#deps.setTunnels(frame.tunnels);
      return [];
    }
    if (isTerminalFrame(frame)) {
      this.#deps.terminal(frame);
      return [];
    }
    if (isTurnFrame(frame)) {
      this.#deps.turn(frame);
      return [];
    }
    if (!('cmdId' in frame)) return [];
    const { cmdId } = frame;
    const earlier = this.#answered.get(cmdId);
    if (earlier) return [earlier];
    if (this.#running.has(cmdId)) return [];
    this.#running.add(cmdId);
    try {
      const answer = await this.#run(frame);
      this.#remember(cmdId, answer);
      return [answer];
    } finally {
      this.#running.delete(cmdId);
    }
  }

  /**
   * The answer to a frame this runner cannot read (an unknown `type`, or one that fails its schema) when it carries a
   * `cmdId`, so the server does not wait for it; nothing otherwise.
   */
  refuse(text: string, why: string): RunnerFrame[] {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return [];
    }
    const { type, cmdId } = (value ?? {}) as { type?: unknown; cmdId?: unknown };
    if (!isUuid(cmdId)) return [];
    const error = why.slice(0, 2000);
    if (type === 'power.command') return [{ type: 'power.result', cmdId, ok: false, error }];
    if (type === 'runner.update') return [{ type: 'runner.update.result', cmdId, ok: false, error }];
    return [ack(cmdId, error)];
  }

  async #run(frame: Extract<ServerFrame, { cmdId: string }>): Promise<Answer> {
    try {
      switch (frame.type) {
        case 'machine.hold':
          await this.#deps.setServerHold(frame.until);
          return ack(frame.cmdId);
        case 'power.command':
          return await runPowerCommand(this.#deps.power, frame);
        case 'runner.update':
          return await this.#deps.update(frame);
        case 'key.rotate':
          await this.#deps.saveKey(frame.runnerKey);
          this.#deps.log.info('saved the rotated runner key');
          return ack(frame.cmdId);
        case 'runner.drain':
          this.#deps.drain();
          return ack(frame.cmdId);
        default:
          return ack(frame.cmdId, NO_RUNS);
      }
    } catch (error) {
      // `runPowerCommand` and `update` never throw, so this is never a power command or an update.
      this.#deps.log.error('a command failed', { type: frame.type, error });
      return ack(frame.cmdId, messageOf(error));
    }
  }

  #remember(cmdId: string, answer: Answer): void {
    this.#answered.set(cmdId, answer);
    if (this.#answered.size <= REMEMBERED_COMMANDS) return;
    const oldest = this.#answered.keys().next().value as string;
    this.#answered.delete(oldest);
  }
}

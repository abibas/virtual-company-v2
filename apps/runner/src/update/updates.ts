import type { RunnerUpdate, RunnerUpdateResult } from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { Timers } from '../system/time.ts';
import { type SelfUpdate, UpdateError } from './self-update.ts';

/**
 * The server's `runner.update` (docs/runner-protocol.md, "Updating a runner"): a runner that cannot update itself
 * answers `unsupported`, one with live runs `busy` (S5's runs: it never ends one for an update); otherwise it puts the
 * server's runner in place (`self-update.ts`), ends its open terminals with a notice, answers `ok` with the new build
 * and, a moment later (so the answer leaves first), asks to restart: the daemon stops and exits with a code its service
 * manager starts it again after (`daemon/start.ts`). A failed update answers why, and the runner goes on as it was.
 */

/** How long after its answer the runner stops for its restart. */
export const RESTART_DELAY_MS = 250;

/** What an open terminal prints before the runner restarts on its update. */
export const UPDATE_NOTICE =
  '\r\n[Closing this terminal: the runner is restarting on its update. Open it again in a moment.]\r\n';

/** The longest error the protocol takes. */
const ERROR_MAX = 2000;

export interface UpdatesDeps {
  /** Undefined when this runner cannot update itself (`caps.selfUpdate` false). */
  readonly update: SelfUpdate | undefined;
  /** The server it is linked to (its configuration's), where the new files come from. */
  serverUrl(): string;
  /** How many runs are live. */
  liveRuns(): number;
  /** Ends every open terminal, printing `notice` in it first (the runner restarts under them). */
  closeTerminals(notice: string): Promise<void>;
  readonly timers: Timers;
  readonly log: Log;
}

export class Updates {
  /** Resolves once an update is in place and answered: the runner then restarts. */
  readonly restart: Promise<void>;
  readonly #deps: UpdatesDeps;
  readonly #restart: () => void;
  #busy = false;

  constructor(deps: UpdatesDeps) {
    this.#deps = deps;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.restart = promise;
    this.#restart = resolve;
  }

  /** True when this runner updates itself (`caps.selfUpdate`). */
  get available(): boolean {
    return this.#deps.update !== undefined;
  }

  /** The answer to a `runner.update`; never throws. */
  async handle(frame: RunnerUpdate): Promise<RunnerUpdateResult> {
    const { cmdId } = frame;
    const refuse = (error: string): RunnerUpdateResult => ({
      type: 'runner.update.result',
      cmdId,
      ok: false,
      error: error.slice(0, ERROR_MAX),
    });
    const { update, log } = this.#deps;
    if (update === undefined) {
      return refuse('unsupported: this runner is not an installed copy that launchd or systemd restarts');
    }
    const live = this.#deps.liveRuns();
    if (live > 0) return refuse(`busy: ${live} live run${live === 1 ? '' : 's'}; update it once they end`);
    if (this.#busy) return refuse('busy: an update is under way');
    this.#busy = true;
    try {
      log.info('updating this runner from the server', { manager: update.manager });
      const { build, pty } = await update.apply(this.#deps.serverUrl());
      log.info('updated; restarting on the new build', { build, pty });
      await this.#deps.closeTerminals(UPDATE_NOTICE);
      this.#deps.timers.setTimeout(() => this.#restart(), RESTART_DELAY_MS);
      return { type: 'runner.update.result', cmdId, ok: true, build };
    } catch (error) {
      this.#busy = false;
      const why =
        error instanceof UpdateError
          ? `${error.code}: ${error.message}`
          : `write_failed: ${(error as Error).message}`;
      log.warn('the update failed; the runner goes on as it was', { error: why });
      return refuse(why);
    }
  }
}

import { newId } from '@mwc/shared/ids';
import {
  LoginHelperError,
  type LoginSandbox,
  type SandboxExit,
} from '../../../../platform/login-helper/port.ts';
import {
  exitEnding,
  finishesOnExit,
  isActive,
  PROVIDER_NAMES,
  SIGN_IN_ENDINGS,
  type SignInState,
  takesCode,
} from '../../rules/sign-in.ts';
import type { SignInView } from '../../schemas/sign-in.ts';
import type { SessionContext, SessionOwner } from './context.ts';
import type { SignInFlow } from './flows.ts';

/** The most output kept to read the screen from: the address and the prompts come first. */
const SCREEN_MAX = 64 * 1024;

/**
 * One sign-in, in memory: its sandbox, the CLI's output (kept only to read the screen, never logged, dropped when it
 * ends), its state and its timers. Whatever ends it (done, failed, expired, cancelled) kills the sandbox. Once the
 * login's files are being stored, a cancel or the limit waits for the store to finish, so a stored subscription is
 * never reported as cancelled.
 */
export class SignInSession {
  readonly id = newId();
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly owner: SessionOwner;
  readonly #ctx: SessionContext;
  readonly #flow: SignInFlow;
  readonly #label: string | undefined;
  #state: SignInState = 'starting';
  #url: string | null = null;
  #userCode: string | null = null;
  #credentialId: string | null = null;
  #message: string | null = null;
  #screen = '';
  #sandbox: LoginSandbox | undefined;
  #limit: unknown;
  #wait: unknown;
  #storing = false;

  constructor(ctx: SessionContext, owner: SessionOwner, flow: SignInFlow, label: string | undefined) {
    this.#ctx = ctx;
    this.owner = owner;
    this.#flow = flow;
    this.#label = label;
    this.createdAt = ctx.clock();
    this.expiresAt = new Date(this.createdAt.getTime() + ctx.limits.ttlMs);
  }

  get active(): boolean {
    return isActive(this.#state);
  }

  view(): SignInView {
    return {
      id: this.id,
      provider: this.#flow.provider,
      state: this.#state,
      url: this.#url,
      userCode: this.#userCode,
      credentialId: this.#credentialId,
      message: this.#message,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
    };
  }

  /** Sets the 10-minute limit and starts the sandbox in the background. */
  begin(): void {
    this.#limit = this.#ctx.timers.setTimeout(() => this.#timeUp(), this.#ctx.limits.ttlMs);
    void this.#launch();
  }

  /** Types Claude's code into the CLI; false when this sign-in is not waiting for one. */
  submitCode(code: string): boolean {
    if (!takesCode(this.#flow.provider, this.#state)) return false;
    // Completing before the code goes in: the CLI may answer and exit at once.
    this.#state = 'completing';
    this.#waitFor(this.#ctx.limits.codeWaitMs, SIGN_IN_ENDINGS.codeTimeout);
    this.#sandbox?.write(`${code}\r`);
    return true;
  }

  cancel(): void {
    if (!this.#storing) this.#end('cancelled', SIGN_IN_ENDINGS.cancelled, 'cancelled');
  }

  /** Ends it as expired when its limit has passed by the clock (a poll can come before the timer). */
  expireIfDue(): void {
    if (this.#ctx.clock() >= this.expiresAt) this.#timeUp();
  }

  get #name(): string {
    return PROVIDER_NAMES[this.#flow.provider];
  }

  #timeUp(): void {
    if (!this.#storing) this.#end('expired', SIGN_IN_ENDINGS.expired, 'expired');
  }

  async #launch(): Promise<void> {
    let sandbox: LoginSandbox;
    try {
      sandbox = await this.#ctx.helper.start({ argv: this.#flow.argv });
    } catch (error) {
      if (!(error instanceof LoginHelperError)) {
        this.#ctx.logger.error({ signInId: this.id, err: error }, 'the sign-in helper failed');
      }
      const message =
        error instanceof LoginHelperError ? error.message : 'The sign-in helper could not start.';
      this.#end('failed', message, 'helper');
      return;
    }
    this.#sandbox = sandbox;
    if (!this.active) {
      await this.#kill();
      return;
    }
    this.#waitFor(this.#ctx.limits.addressWaitMs, SIGN_IN_ENDINGS.noAddress(this.#name));
    sandbox.onOutput((chunk) => this.#read(chunk));
    sandbox.onExit((exit) => void this.#exited(exit));
  }

  /** Reads the screen until the address (and Claude's prompt) is on it. */
  #read(chunk: string): void {
    if (this.#state !== 'starting' && this.#state !== 'waiting_for_user') return;
    this.#screen = (this.#screen + chunk).slice(-SCREEN_MAX);
    const shown = this.#flow.read(this.#screen);
    if (shown === undefined) return;
    if (this.#state === 'starting') this.#clearWait();
    this.#url = shown.url;
    this.#userCode = shown.userCode;
    this.#state = shown.asksForCode ? 'waiting_for_code' : 'waiting_for_user';
  }

  /** The CLI stopped: a finished login (after Claude's code, or OpenAI's device approval) is read, else it failed. */
  async #exited(exit: SandboxExit): Promise<void> {
    if (!this.active) return;
    if (exit.code === 0 && finishesOnExit(this.#flow.provider, this.#state)) return this.#complete();
    const ending = exit.error ?? exitEnding(this.#flow.provider, this.#state);
    this.#end('failed', ending, `exit ${exit.code ?? 'none'}`);
  }

  /** Reads the login's files from the sandbox, stores them sealed under the owner, and ends done. */
  async #complete(): Promise<void> {
    this.#state = 'completing';
    this.#clearWait();
    this.#storing = true;
    try {
      const outcome = await this.#flow.result(this.#sandbox as LoginSandbox);
      if (!outcome.ok) return this.#end('failed', outcome.message, 'no_login');
      const { label, ...login } = outcome.result;
      const stored = await this.#ctx.secrets.storeCredential({
        ...login,
        label: this.#label ?? label,
        ownerUserId: this.owner.userId,
        requestId: this.owner.requestId,
      });
      this.#credentialId = stored.id;
      this.#end('done', null, 'stored');
    } catch (error) {
      // The error's name only: a driver's message can quote the row.
      this.#end('failed', SIGN_IN_ENDINGS.notSaved, `store_failed ${(error as Error).name}`);
    } finally {
      this.#storing = false;
    }
  }

  #waitFor(ms: number, message: string): void {
    this.#clearWait();
    this.#wait = this.#ctx.timers.setTimeout(() => {
      if (!this.#storing) this.#end('failed', message, 'timeout');
    }, ms);
  }

  #clearWait(): void {
    if (this.#wait !== undefined) this.#ctx.timers.clearTimeout(this.#wait);
    this.#wait = undefined;
  }

  /** Ends the sign-in once: the state and message, the timers cleared, the screen dropped, the sandbox killed. */
  #end(state: SignInState, message: string | null, reason: string): void {
    if (!this.active) return;
    this.#state = state;
    this.#message = message;
    this.#ctx.timers.clearTimeout(this.#limit);
    this.#clearWait();
    this.#screen = '';
    void this.#kill();
    const line = { signInId: this.id, provider: this.#flow.provider, state, reason };
    this.#ctx.logger.info(line, 'sign-in ended');
  }

  async #kill(): Promise<void> {
    try {
      await this.#sandbox?.kill();
    } catch (error) {
      this.#ctx.logger.warn({ signInId: this.id, err: error }, 'the sign-in sandbox was not removed');
    }
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SIGN_IN_ENDINGS, SIGN_IN_LIMITS } from '../../../../../src/modules/credentials/rules/sign-in.ts';
import { SYSTEM_SIGN_IN_TIMERS } from '../../../../../src/modules/credentials/service/sign-in/context.ts';
import { CLAUDE_CODE, CLAUDE_OUTPUT } from '../../../../fixtures/sign-in/cli.ts';
import { claudeScript, codexScript, helperError, settle } from '../../../../fixtures/sign-in/helper.ts';
import {
  as,
  type SignInWorld,
  signInOf,
  signInWorld,
  untilState,
} from '../../../../fixtures/sign-in/world.ts';

let s: SignInWorld;
beforeAll(async () => {
  s = await signInWorld();
});
afterAll(() => s.w.t.close());
beforeEach(() => s.reset());

const start = (provider: 'claude' | 'openai' = 'claude', label?: string) =>
  signInOf(s.signIns.start(as(s.ihor), label === undefined ? { provider } : { provider, label }));
const read = (id: string) => signInOf(s.signIns.get(as(s.ihor), id));
const code = (id: string) => s.signIns.submitCode(as(s.ihor), id, CLAUDE_CODE);
const ended = () => s.w.t.logs.filter((line) => line.msg === 'sign-in ended').at(-1);

describe('the 10-minute limit', () => {
  it('expires a sign-in when its timer fires, killing the sandbox', async () => {
    const started = start();
    await settle();
    s.timers.fire(SIGN_IN_LIMITS.ttlMs);
    expect(read(started.id)).toMatchObject({ state: 'expired', message: SIGN_IN_ENDINGS.expired });
    expect(s.helper.last.kills).toBe(1);
    expect(s.timers.pending).toEqual([]);
  });

  it('expires it on a poll once the clock has passed it, before any timer', async () => {
    const started = start();
    await settle();
    s.w.clock.advance(SIGN_IN_LIMITS.ttlMs);
    expect(read(started.id).state).toBe('expired');
    expect(s.helper.last.kills).toBe(1);
    expect(start('openai').state).toBe('starting');
  });

  it('fails a CLI that shows no address in time', async () => {
    s.helper.script = { ...claudeScript(), output: [CLAUDE_OUTPUT.opening] };
    const started = start();
    await settle();
    expect(s.timers.pending).toContain(SIGN_IN_LIMITS.addressWaitMs);
    s.timers.fire(SIGN_IN_LIMITS.addressWaitMs);
    expect(read(started.id)).toMatchObject({
      state: 'failed',
      message: 'Claude did not show a sign-in address in time. Start again.',
    });
    expect(ended()).toMatchObject({ reason: 'timeout' });
  });
});

describe('cancel', () => {
  it('ends the sign-in and kills the sandbox once; later output and exits change nothing', async () => {
    s.helper.script = { ...claudeScript(), output: [CLAUDE_OUTPUT.opening] };
    const started = start();
    await settle();
    expect(signInOf(s.signIns.cancel(as(s.ihor), started.id))).toMatchObject({
      state: 'cancelled',
      message: SIGN_IN_ENDINGS.cancelled,
    });
    signInOf(s.signIns.cancel(as(s.ihor), started.id));
    s.helper.last.emit(CLAUDE_OUTPUT.address, CLAUDE_OUTPUT.prompt);
    s.helper.last.exit(0);
    await settle();
    expect(read(started.id)).toMatchObject({ state: 'cancelled', url: null });
    expect(s.helper.last.kills).toBe(1);
    expect(code(started.id)).toMatchObject({ code: 'sign_in_not_waiting' });
  });

  it('kills a sandbox that comes up after the sign-in was cancelled, reading none of it', async () => {
    let open = () => {};
    s.helper.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const started = start();
    s.signIns.cancel(as(s.ihor), started.id);
    open();
    await settle();
    expect(s.helper.last.kills).toBe(1);
    expect(read(started.id)).toMatchObject({ state: 'cancelled', url: null });
  });

  it('waits for a login being stored: a cancel or the limit then leaves it to finish done', async () => {
    const started = start();
    await settle();
    let release = () => {};
    s.helper.last.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    code(started.id);
    await settle();
    expect(signInOf(s.signIns.cancel(as(s.ihor), started.id)).state).toBe('completing');
    s.timers.fire(SIGN_IN_LIMITS.ttlMs);
    s.timers.fire(SIGN_IN_LIMITS.codeWaitMs);
    s.w.clock.advance(SIGN_IN_LIMITS.ttlMs);
    expect(read(started.id).state).toBe('completing');
    release();
    await untilState(s, started.id, 'done');
  });
});

describe('failures', () => {
  it("says the helper's own words when the sandbox could not be made", async () => {
    s.helper.failNext = helperError('Docker is not available on this server. Start Docker and try again.');
    const started = start();
    await settle();
    expect(read(started.id)).toMatchObject({
      state: 'failed',
      message: 'Docker is not available on this server. Start Docker and try again.',
    });
  });

  it('logs an unexpected helper error and says it plainly', async () => {
    s.helper.failNext = new Error('mkdtemp failed');
    const started = start();
    await settle();
    expect(read(started.id)).toMatchObject({
      state: 'failed',
      message: 'The sign-in helper could not start.',
    });
    expect(
      s.w.t.logs.some((line) => line.msg === 'the sign-in helper failed' && line.signInId === started.id),
    ).toBe(true);
  });

  it('says why when the CLI could not run, stopped before its address, or stopped while waiting', async () => {
    s.helper.script = { ...claudeScript(), output: [] };
    const missing = start();
    await settle();
    s.helper.last.exit(null, 'The sign-in tools (script, claude, codex) are not installed on this server.');
    expect(read(missing.id).message).toBe(
      'The sign-in tools (script, claude, codex) are not installed on this server.',
    );

    const early = start();
    await settle();
    s.helper.last.exit(1);
    expect(read(early.id).message).toBe('Claude did not show a sign-in address in time. Start again.');
    expect(ended()).toMatchObject({ reason: 'exit 1' });

    s.helper.script = claudeScript();
    const waiting = start();
    await settle();
    s.helper.last.exit(0);
    expect(read(waiting.id)).toMatchObject({
      state: 'failed',
      message: 'The Claude sign-in stopped before it finished. Start again.',
    });
  });

  it('fails in plain words when the login cannot be stored, logging only the error name', async () => {
    const started = start('claude', 'x'.repeat(81));
    await settle();
    code(started.id);
    await untilState(s, started.id, 'failed');
    expect(read(started.id).message).toBe(SIGN_IN_ENDINGS.notSaved);
    expect(ended()).toMatchObject({ reason: 'store_failed RangeError', state: 'failed' });
  });

  it('logs a sandbox that could not be removed', async () => {
    s.helper.script = codexScript();
    const started = start('openai');
    await settle();
    s.helper.last.kill = async () => {
      throw new Error('docker rm failed');
    };
    s.signIns.cancel(as(s.ihor), started.id);
    await settle();
    expect(s.w.t.logs.at(-1)).toMatchObject({
      msg: 'the sign-in sandbox was not removed',
      signInId: started.id,
    });
  });
});

describe('the system timers', () => {
  it('are unref’d and can be cleared', () => {
    let fired = false;
    const handle = SYSTEM_SIGN_IN_TIMERS.setTimeout(() => {
      fired = true;
    }, 60_000) as NodeJS.Timeout;
    expect(handle.hasRef()).toBe(false);
    SYSTEM_SIGN_IN_TIMERS.clearTimeout(handle);
    expect(fired).toBe(false);
  });
});

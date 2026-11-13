import { SlackError } from '@mwc/tools-core';
import { describe, expect, it, vi } from 'vitest';
import {
  FAILED_FOR_MS,
  IDLE_MS,
  LIMIT_WAITS,
  MAX_PAGES,
  REFRESH_MS,
  slackDirectory,
  UNSAID_WAIT_MS,
} from '../../../../../../src/modules/integrations/service/slack/inbound/directory.ts';
import {
  limited,
  page,
  type Step,
  scriptedList,
  slackUser as user,
} from '../../../../../fixtures/integrations/slack-people.ts';

/**
 * The Slack workspaces' people kept in memory (2026-11-13): every `users.list` page loaded once in the background, the
 * first ask answered once the first page is in and the rest said as loading; rate limits waited out as Slack says; a
 * refused load said for a minute; the list loaded again after 6 hours (the old one served meanwhile) or on demand (the
 * list dropped); one sign-in opening per load; a sign-in nobody asked about for a day forgotten.
 */

const T0 = Date.parse('2026-11-13T09:00:00Z');

function directoryOf(steps: Step[]) {
  const list = scriptedList(steps);
  let now = T0;
  const waits: number[] = [];
  const warn = vi.fn();
  const directory = slackDirectory({
    slack: { listUsers: list.listUsers },
    clock: () => new Date(now),
    logger: { warn },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  const open = vi.fn(async () => ({ ok: true as const, signIn: { token: 'xoxb-test' } }));
  return {
    list,
    waits,
    warn,
    open,
    view: (key = 'sign-in', refresh = false) => directory.view(key, open, { refresh }),
    forget: (key: string) => directory.forget(key),
    later: (ms: number) => {
      now += ms;
    },
  };
}

/** Lets the background load run on. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

const viewOf = (answer: Awaited<ReturnType<ReturnType<typeof directoryOf>['view']>>) => {
  if (!answer.ok) throw new Error('expected people');
  return { ids: answer.view.people.map((person) => person.id), loading: answer.view.loading };
};

const IHOR = user('U0IHOR', 'ihor', { realName: 'Ihor Herasko' });
const ANNA = user('U0ANNA', 'anna');
const ERIK = user('U0ERIK', 'erik');

describe('a load', () => {
  it('reads every page once, answering after the first with the people so far, without bots or the departed', async () => {
    const d = directoryOf([
      page([IHOR, user('U0BOT1', 'bot', { isBot: true }), user('U0GONE', 'gone', { deleted: true })], 'c2'),
      { held: page([ANNA, IHOR], null) },
    ]);
    const [first, same] = await Promise.all([d.view(), d.view()]);
    expect(viewOf(first)).toEqual({ ids: ['U0IHOR'], loading: true });
    expect(viewOf(same).loading).toBe(true);
    d.list.release();
    await flush();
    const loaded = await d.view();
    expect(viewOf(loaded)).toEqual({ ids: ['U0IHOR', 'U0ANNA'], loading: false });
    expect(loaded.ok && loaded.view.loadedAt?.getTime()).toBe(T0);
    expect(d.list.cursors).toEqual([undefined, 'c2']);
    expect(d.open).toHaveBeenCalledTimes(1);
  });

  it('waits out rate limits for as long as Slack says, 30 s when it says nothing', async () => {
    const d = directoryOf([limited(45_000), page([IHOR], 'c2'), limited(null), page([ANNA])]);
    expect(viewOf(await d.view())).toEqual({ ids: [], loading: true });
    await flush();
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR', 'U0ANNA'], loading: false });
    expect(d.waits).toEqual([45_000, UNSAID_WAIT_MS]);
    expect(d.list.cursors).toEqual([undefined, undefined, 'c2', 'c2']);
  });

  it('gives up after 10 rate limits in a row, says so for a minute, then tries again', async () => {
    const d = directoryOf([limited(1000)]);
    await d.view();
    await flush();
    expect(d.waits).toHaveLength(LIMIT_WAITS);
    expect(await d.view()).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    d.later(FAILED_FOR_MS - 1);
    expect(await d.view()).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(d.open).toHaveBeenCalledTimes(1);
    d.later(1);
    await d.view();
    expect(d.open).toHaveBeenCalledTimes(2);
    expect(d.warn).toHaveBeenCalledWith(
      { credentialId: 'sign-in', code: 'rate_limited' },
      'Slack people: the load failed',
    );
  });

  it('answers a refused first page at once, and an unexpected failure as Slack being away', async () => {
    const refused = directoryOf([new SlackError('forbidden', { slackError: 'missing_scope' })]);
    expect(await refused.view()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const broken = directoryOf([new TypeError('boom')]);
    expect(await broken.view()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('stops at its most pages', async () => {
    const d = directoryOf([page([IHOR], 'again')]);
    await d.view();
    await flush();
    await vi.waitFor(async () => expect(viewOf(await d.view()).loading).toBe(false));
    expect(d.list.cursors).toHaveLength(MAX_PAGES);
  });

  it('says the sign-in’s refusal and opens it again on the next ask', async () => {
    const d = directoryOf([page([IHOR])]);
    const refusal = {
      ok: false as const,
      status: 422 as const,
      code: 'credential_revoked',
      message: 'Revoked',
    };
    d.open.mockResolvedValueOnce(refusal as never);
    expect(await d.view()).toBe(refusal);
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR'], loading: false });
    expect(d.open).toHaveBeenCalledTimes(2);
  });

  it('is not left under way when opening the sign-in throws', async () => {
    const d = directoryOf([page([IHOR])]);
    d.open.mockRejectedValueOnce(new Error('database away'));
    await expect(d.view()).rejects.toThrow('database away');
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR'], loading: false });
  });
});

describe('the list kept', () => {
  it('is loaded again after 6 hours, the old one served meanwhile, and kept when that load fails', async () => {
    const d = directoryOf([page([IHOR]), { held: page([IHOR, ANNA]) }, new SlackError('unavailable')]);
    await d.view();
    await flush();
    d.later(REFRESH_MS - 1);
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR'], loading: false });
    expect(d.open).toHaveBeenCalledTimes(1);
    d.later(1);
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR'], loading: false });
    d.list.release();
    await flush();
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR', 'U0ANNA'], loading: false });
    d.later(REFRESH_MS);
    await d.view();
    await flush();
    expect(viewOf(await d.view())).toEqual({ ids: ['U0IHOR', 'U0ANNA'], loading: false });
    expect(d.open).toHaveBeenCalledTimes(3);
    d.later(FAILED_FOR_MS);
    await d.view();
    expect(d.open).toHaveBeenCalledTimes(4);
  });

  it('is dropped and loaded again on demand, its progress shown', async () => {
    const d = directoryOf([page([IHOR]), page([ERIK], 'c2'), { held: page([ANNA]) }]);
    await d.view();
    await flush();
    expect(viewOf(await d.view('sign-in', true))).toEqual({ ids: ['U0ERIK'], loading: true });
    expect(viewOf(await d.view('sign-in', true))).toEqual({ ids: ['U0ERIK'], loading: true });
    d.list.release();
    await flush();
    expect(viewOf(await d.view())).toEqual({ ids: ['U0ERIK', 'U0ANNA'], loading: false });
    expect(d.open).toHaveBeenCalledTimes(2);
  });

  it('is forgotten when asked, or when nobody asked about its sign-in for a day', async () => {
    const d = directoryOf([page([IHOR])]);
    await d.view('a');
    await d.view('b');
    d.forget('b');
    expect(d.open).toHaveBeenCalledTimes(2);
    d.later(IDLE_MS);
    await d.view('c');
    d.later(1);
    // 'a' was forgotten by the sweep: loaded afresh, not refreshed in the background with its old list served.
    await d.view('a');
    await d.view('b');
    expect(d.open).toHaveBeenCalledTimes(5);
  });
});

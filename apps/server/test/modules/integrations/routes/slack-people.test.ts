import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eventually, usesOf } from '../../../fixtures/chats/world.ts';
import { rawUser, slackScene } from '../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  callsOf,
  formOf,
  type InboundWorld,
  inboundPath,
  inboundWorld,
  ok,
  slackError,
} from '../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../fixtures/members/members.ts';
import { revokeSubscription } from '../../../fixtures/org.ts';

/**
 * A Slack bot sign-in's people search (2026-11-13): no words warm the workspace's directory (every `users.list` page,
 * loaded once in the background); a search ranks it at once, with titles, emails and avatars, and says while it loads;
 * one use of the sign-in per load, not per search; a whole email nobody has is looked up; a reload on demand; Slack's
 * refusals and outages in words.
 */

let w: InboundWorld;

beforeAll(async () => {
  w = await inboundWorld();
});
afterEach(() => {
  w.provider.reset();
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

type Scene = Awaited<ReturnType<typeof slackScene>>;

/** The search's answer (a refusal's body is `{error}` instead). */
interface People {
  readonly people: readonly { readonly id: string }[];
  readonly loading: boolean;
  readonly loaded: number;
  readonly loadedAt: string | null;
}

const search = async (s: Scene, q?: string) => {
  const res = await as(w, s.company.owner)(
    'GET',
    `${inboundPath(s.signIn.id, 'slack-people')}${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`,
  );
  return { status: res.status, body: res.body as People };
};

/** Waits until the sign-in's directory is loaded. */
const loaded = (s: Scene) =>
  eventually('the people loaded', async () => (await search(s)).body.loading === false);

const peopleUses = async (s: Scene) =>
  (await usesOf(w.t.db, s.signIn.id)).filter((use) => use.purpose === 'slack_people').length;

const IHOR = rawUser('U0IHOR', 'ihor', {
  real_name: 'Ihor Herasko',
  profile: {
    display_name: 'ihor',
    title: 'CEO',
    email: 'ihor@airia.com',
    image_72: 'https://a.slack-edge.com/i.png',
  },
});

describe('the people search', () => {
  it('warms the directory, then ranks it at once: one load and one use for many searches', async () => {
    const s = await slackScene(w);
    answerSlack(w, {
      'users.list': [
        ok({
          members: [IHOR, rawUser('U0BOTX', 'ihorbot', { is_bot: true })],
          response_metadata: { next_cursor: 'next' },
        }),
        ok({
          members: [rawUser('U0GONE', 'ihor-old', { deleted: true }), rawUser('U0VIHO', 'Vihorev')],
        }),
      ],
    });
    const warm = await search(s);
    expect(warm).toMatchObject({ status: 200, body: { people: [] } });
    expect(warm.body.loaded).toBeGreaterThanOrEqual(1);
    await loaded(s);
    const found = await search(s, 'IHOR');
    expect(found).toMatchObject({
      status: 200,
      body: {
        people: [
          {
            id: 'U0IHOR',
            name: 'Ihor Herasko',
            title: 'CEO',
            email: 'ihor@airia.com',
            image: 'https://a.slack-edge.com/i.png',
          },
          { id: 'U0VIHO', name: 'Vihorev', title: null, email: null, image: null },
        ],
        loading: false,
        loaded: 2,
      },
    });
    expect(found.body.loadedAt).toEqual(expect.any(String));
    await search(s, 'iho');
    await search(s, 'her');
    expect(callsOf(w, 'users.list').map(formOf)).toEqual([
      { limit: '200' },
      { limit: '200', cursor: 'next' },
    ]);
    expect(await peopleUses(s)).toBe(1);
  });

  it('looks up a whole email nobody in the directory has, none when Slack knows no such person', async () => {
    const s = await slackScene(w);
    answerSlack(w, {
      'users.list': ok({ members: [IHOR] }),
      'users.lookupByEmail': [
        ok({ user: rawUser('U0ANNA', 'anna', { profile: { image_72: 'http://x' } }) }),
        slackError('users_not_found'),
        ok({ user: rawUser('U0BOTX', 'bot', { is_bot: true }) }),
      ],
    });
    await loaded(s);
    expect((await search(s, 'Ihor@Airia.com')).body.people).toMatchObject([{ id: 'U0IHOR' }]);
    expect((await search(s, 'anna@airia.com')).body.people).toEqual([
      { id: 'U0ANNA', name: 'anna', title: null, email: null, image: null },
    ]);
    expect((await search(s, 'nobody@airia.com')).body.people).toEqual([]);
    expect((await search(s, 'bot@airia.com')).body.people).toEqual([]);
    expect(callsOf(w, 'users.lookupByEmail').map(formOf)).toEqual([
      { email: 'anna@airia.com' },
      { email: 'nobody@airia.com' },
      { email: 'bot@airia.com' },
    ]);
  });

  it('loads the directory again on demand', async () => {
    const s = await slackScene(w);
    answerSlack(w, {
      'users.list': [ok({ members: [IHOR] }), ok({ members: [IHOR, rawUser('U0ANNA', 'anna')] })],
    });
    await loaded(s);
    const reload = await as(w, s.company.owner)(
      'POST',
      `${inboundPath(s.signIn.id, 'slack-people')}/refresh`,
    );
    expect(reload.status).toBe(200);
    await loaded(s);
    expect((await search(s, 'anna')).body.people).toMatchObject([{ id: 'U0ANNA' }]);
    expect(callsOf(w, 'users.list')).toHaveLength(2);
    expect(await peopleUses(s)).toBe(2);
  });

  it('says Slack’s refusals and outages in words', async () => {
    const refused = await slackScene(w);
    answerSlack(w, { 'users.list': slackError('missing_scope', { needed: 'users:read' }) });
    expect(await search(refused, 'ihor')).toMatchObject({
      status: 422,
      body: { error: { code: 'slack_refused' } },
    });
    const away = await slackScene(w);
    answerSlack(w, { 'users.list': slackError('fatal_error') });
    expect(await search(away, 'ihor')).toMatchObject({
      status: 502,
      body: { error: { code: 'provider_unavailable' } },
    });
    const lookup = await slackScene(w);
    answerSlack(w, {
      'users.list': ok({ members: [] }),
      'users.lookupByEmail': slackError('missing_scope', { needed: 'users:read.email' }),
    });
    await loaded(lookup);
    expect((await search(lookup, 'ihor@airia.com')).status).toBe(422);
    expect((await search(lookup, 'x'.repeat(101))).status).toBe(400);
    await revokeSubscription(w.t.db, lookup.signIn.id);
    expect(await search(lookup, 'ihor')).toMatchObject({
      status: 422,
      body: { error: { code: 'credential_revoked' } },
    });
    const reload = as(w, lookup.company.owner)(
      'POST',
      `${inboundPath(lookup.signIn.id, 'slack-people')}/refresh`,
    );
    expect((await reload).status).toBe(422);
    const elsewhere = await slackScene(w);
    expect(
      (await as(w, refused.company.owner)('GET', inboundPath(elsewhere.signIn.id, 'slack-people'))).status,
    ).toBe(404);
  });
});

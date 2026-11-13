import { owned } from '@mwc/db';
import { isSlackError, type SlackError, type SlackSignIn } from '@mwc/tools-core';
import {
  type DirectoryPerson,
  directoryPerson,
  isPerson,
  isWholeEmail,
  rankPeople,
} from '../../../rules/slack/inbound/people.ts';
import type { SlackFound } from '../../../schemas/slack-inbound.ts';
import type { InboundDeps } from './context.ts';
import { type DirectoryDeps, slackDirectory } from './directory.ts';
import { botSignIn } from './settings.ts';

/**
 * The workspace's people for a connection's "Only these people" (2026-11-13): searched among the bot sign-in's
 * workspace directory kept in memory (`directory.ts`: every `users.list` page loaded once, `users:read`), ranked by
 * `rankPeople` (name words starting with the typed words, then names holding them, then emails; `users:read.email` gives
 * the emails); an ask with no words only warms the directory. A whole email nobody in it has is looked up with
 * `users.lookupByEmail`. While the directory loads, the answer has the people so far and says so. The bot sign-in is
 * opened for `slack_people` once per load or email lookup. Slack's refusals come back in words.
 */

export type PeopleRefusal = {
  readonly ok: false;
  readonly status: 404 | 422 | 502;
  readonly code: string;
  readonly message: string;
};

export interface PeopleAnswer {
  readonly ok: true;
  readonly people: SlackFound[];
  readonly loading: boolean;
  readonly loaded: number;
  readonly loadedAt: string | null;
}

export interface PeopleDeps extends InboundDeps {
  readonly sleep?: DirectoryDeps['sleep'];
}

const foundOf = (person: DirectoryPerson): SlackFound => ({
  id: person.id,
  name: person.name,
  title: person.title,
  email: person.email,
  image: person.image,
});

/** Slack's error as a refusal in words: an outage 502, anything else Slack refused 422. */
function refusalOf(error: SlackError): PeopleRefusal {
  const away =
    error.code === 'unavailable' || error.code === 'rate_limited' || error.code === 'invalid_response';
  return away
    ? { ok: false, status: 502, code: 'provider_unavailable', message: error.message }
    : { ok: false, status: 422, code: 'slack_refused', message: error.message };
}

/** The people search on these deps, with its directory. */
export function slackPeople(deps: PeopleDeps) {
  const { slack, clock, logger, sleep } = deps;
  const directory = slackDirectory({ slack, clock, logger, sleep });

  /** The bot sign-in opened for `slack_people` (a use), or why not. */
  async function open(
    userId: string,
    credentialId: string,
  ): Promise<{ readonly ok: true; readonly signIn: SlackSignIn } | PeopleRefusal> {
    const opened = await deps.credentials.slackBot(credentialId, userId, { purpose: 'slack_people' });
    if (!opened.ok) return { ok: false, status: 422, code: 'credential_revoked', message: opened.message };
    return { ok: true, signIn: { token: opened.token } };
  }

  /** The person with this whole email, as Slack looks them up; none when Slack knows no such person. */
  async function byEmail(userId: string, credentialId: string, email: string) {
    const opened = await open(userId, credentialId);
    if (!opened.ok) return opened;
    try {
      const user = await slack.lookupUserByEmail(opened.signIn, email.toLowerCase());
      return { ok: true, people: isPerson(user) ? [directoryPerson(user)] : [] } as const;
    } catch (error) {
      if (!isSlackError(error)) throw error;
      return error.code === 'not_found' ? ({ ok: true, people: [] } as const) : refusalOf(error);
    }
  }

  return {
    /** The people matching `q` (see above), at most 20; with `refresh`, the directory loaded again first. */
    async search(
      userId: string,
      credentialId: string,
      q: string,
      options: { readonly refresh?: boolean } = {},
    ): Promise<PeopleAnswer | PeopleRefusal> {
      const bot = await botSignIn(owned(deps.db, userId), credentialId);
      if ('ok' in bot) {
        directory.forget(credentialId);
        return bot;
      }
      const viewed = await directory.view<PeopleRefusal>(
        credentialId,
        () => open(userId, credentialId),
        options,
      );
      if (!viewed.ok) return 'error' in viewed ? refusalOf(viewed.error) : viewed;
      const { view } = viewed;
      let people: readonly DirectoryPerson[] = rankPeople(view.people, q);
      if (people.length === 0 && isWholeEmail(q)) {
        const found = await byEmail(userId, credentialId, q.trim());
        if (!found.ok) return found;
        people = found.people;
      }
      return {
        ok: true,
        people: people.map(foundOf),
        loading: view.loading,
        loaded: view.people.length,
        loadedAt: view.loadedAt?.toISOString() ?? null,
      };
    },
  };
}

export type SlackPeople = ReturnType<typeof slackPeople>;

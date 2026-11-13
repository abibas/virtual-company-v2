/**
 * The people search's test helpers (2026-11-13): a Slack person as the connector reads one, and a `users.list` that
 * answers from a script of pages and failures, recording each cursor it was asked for.
 */
import { SlackError, type SlackPage, type SlackUser } from '@mwc/tools-core';

/** A person of the workspace as the connector reads one: no names, title, avatar or email unless `fields` say. */
export const slackUser = (id: string, name: string, fields: Partial<SlackUser> = {}): SlackUser => ({
  id,
  name,
  realName: null,
  displayName: null,
  title: null,
  isBot: false,
  deleted: false,
  timeZone: null,
  image: null,
  email: null,
  ...fields,
});

/** A rate limit as the connector refuses one, its wait kept. */
export const limited = (retryAfterMs: number | null) =>
  new SlackError('rate_limited', { slackError: 'ratelimited', status: 429, retryAfterMs });

/** One step of the script: a page, an error thrown, or a page held until `release` is called. */
export type Step = SlackPage<SlackUser> | Error | { readonly held: SlackPage<SlackUser> };

/** A `users.list` that answers the steps in turn (the last one kept), with the cursors it was asked for. */
export function scriptedList(steps: Step[]) {
  const cursors: (string | undefined)[] = [];
  const releases: (() => void)[] = [];
  let at = 0;
  const listUsers = async (_signIn: unknown, query: { readonly cursor?: string | undefined }) => {
    cursors.push(query.cursor);
    const step = steps[Math.min(at, steps.length - 1)] as Step;
    at += 1;
    if (step instanceof Error) throw step;
    if ('held' in step) {
      await new Promise<void>((resolve) => releases.push(resolve));
      return step.held;
    }
    return step;
  };
  return {
    listUsers,
    cursors,
    /** Lets the held pages answer. */
    release: () => {
      for (const resolve of releases.splice(0)) resolve();
    },
  };
}

/** A page of people, with the cursor to the next one (or none). */
export const page = (users: SlackUser[], nextCursor: string | null = null): SlackPage<SlackUser> => ({
  items: users,
  nextCursor,
});

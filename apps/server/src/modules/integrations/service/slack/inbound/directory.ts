import { isSlackError, type SlackApi, SlackError, type SlackSignIn } from '@mwc/tools-core';
import type { Logger } from 'pino';
import { type DirectoryPerson, directoryPerson, isPerson } from '../../../rules/slack/inbound/people.ts';

/**
 * The Slack workspaces' people, kept in memory per bot sign-in (2026-11-13), so the "Only these people" search filters
 * them at once instead of paging `users.list` (rate tier 2) on every key. The first ask loads every page of 200 in the
 * background, waiting as long as a rate limit's `Retry-After` says (up to 10 limits in a row), and answers once the
 * first page is in; meanwhile it answers with the people loaded so far, `loading`. A list older than 6 hours is loaded
 * again on the next ask while the old one is still served; a refresh asked for drops the list and loads it again.
 * After a load Slack refused, no ask loads for a minute: without a list each says the refusal, with one it is served.
 * The sign-in is opened (a use) once per load, never per search; a sign-in nobody asked about for a day is forgotten.
 */

export const PAGE_SIZE = 200;
export const REFRESH_MS = 6 * 60 * 60_000;
export const FAILED_FOR_MS = 60_000;
export const IDLE_MS = 24 * 60 * 60_000;
/** The rate limits in a row a load waits through before it gives up. */
export const LIMIT_WAITS = 10;
/** A rate limit's wait when Slack says none: its tiers reset within a minute. */
export const UNSAID_WAIT_MS = 30_000;
/** The most pages a load reads (200,000 people). */
export const MAX_PAGES = 1000;

export interface DirectoryDeps {
  readonly slack: Pick<SlackApi, 'listUsers'>;
  readonly clock: () => Date;
  readonly logger: Pick<Logger, 'warn'>;
  /** Waits out a rate limit; omitted, a timer. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** What one ask sees: the people (all, or those loaded so far while `loading`) and when the list was loaded. */
export interface DirectoryView {
  readonly people: readonly DirectoryPerson[];
  readonly loading: boolean;
  readonly loadedAt: Date | null;
}

interface Entry {
  /** The last list loaded whole; empty before. */
  people: DirectoryPerson[];
  loadedAt: number | null;
  /** The people of the load under way, as its pages come in; null when none is. */
  partial: DirectoryPerson[] | null;
  failed: { readonly error: SlackError; readonly at: number } | null;
  usedAt: number;
}

type Opened<R> = { readonly ok: true; readonly signIn: SlackSignIn } | R;

const sleeping = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The directory on these deps (see above). */
export function slackDirectory(deps: DirectoryDeps) {
  const entries = new Map<string, Entry>();
  const sleep = deps.sleep ?? sleeping;
  const now = () => deps.clock().getTime();

  /** Reads every page into the entry; `paged` is told after each page and before each wait. */
  async function readAll(entry: Entry, signIn: SlackSignIn, paged: () => void): Promise<void> {
    const partial = entry.partial as DirectoryPerson[];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let waits = 0;
    for (let pages = 0; pages < MAX_PAGES; ) {
      let page: Awaited<ReturnType<SlackApi['listUsers']>>;
      try {
        page = await deps.slack.listUsers(signIn, { limit: PAGE_SIZE, cursor });
      } catch (error) {
        if (!isSlackError(error) || error.code !== 'rate_limited' || waits >= LIMIT_WAITS) throw error;
        waits += 1;
        paged();
        await sleep(error.retryAfterMs ?? UNSAID_WAIT_MS);
        continue;
      }
      waits = 0;
      pages += 1;
      for (const user of page.items) {
        if (!isPerson(user) || seen.has(user.id)) continue;
        seen.add(user.id);
        partial.push(directoryPerson(user));
      }
      paged();
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    entry.people = partial;
    entry.loadedAt = now();
  }

  /** Runs a load (its `partial` set already); resolves once its first page is in (or it waits, or it ended). */
  function load(key: string, entry: Entry, signIn: SlackSignIn): Promise<void> {
    entry.failed = null;
    let firstPage = () => {};
    const first = new Promise<void>((resolve) => {
      firstPage = resolve;
    });
    readAll(entry, signIn, firstPage)
      .catch((error: unknown) => {
        const failure = isSlackError(error) ? error : new SlackError('unavailable');
        entry.failed = { error: failure, at: now() };
        deps.logger.warn({ credentialId: key, code: failure.code }, 'Slack people: the load failed');
      })
      .finally(() => {
        entry.partial = null;
        firstPage();
      });
    return first;
  }

  /** Forgets the sign-ins nobody asked about for a day. */
  function sweep(at: number) {
    for (const [key, entry] of entries)
      if (entry.partial === null && at - entry.usedAt >= IDLE_MS) entries.delete(key);
  }

  const viewOf = (entry: Entry): DirectoryView => ({
    people: entry.loadedAt === null ? (entry.partial ?? []) : entry.people,
    loading: entry.loadedAt === null && entry.partial !== null,
    loadedAt: entry.loadedAt === null ? null : new Date(entry.loadedAt),
  });

  return {
    /**
     * The people of a sign-in (`key`), loading them when needed with the sign-in `open` gives (or its refusal), or
     * the error its last load ended with.
     */
    async view<R extends { readonly ok: false }>(
      key: string,
      open: () => Promise<Opened<R>>,
      options: { readonly refresh?: boolean } = {},
    ): Promise<
      | { readonly ok: true; readonly view: DirectoryView }
      | { readonly ok: false; readonly error: SlackError }
      | R
    > {
      const at = now();
      sweep(at);
      const entry = entries.get(key) ?? {
        people: [],
        loadedAt: null,
        partial: null,
        failed: null,
        usedAt: at,
      };
      entries.set(key, entry);
      entry.usedAt = at;
      const idle = entry.partial === null;
      if (options.refresh && idle) {
        entry.people = [];
        entry.loadedAt = null;
        entry.failed = null;
      }
      const failed = entry.failed;
      const resting = failed !== null && at - failed.at < FAILED_FOR_MS;
      if (idle && entry.loadedAt === null && resting) return { ok: false, error: failed.error };
      if (idle && !resting && (entry.loadedAt === null || at - entry.loadedAt >= REFRESH_MS)) {
        entry.partial = []; // under way from here: an ask meanwhile sees it loading
        const opened = await open().catch((error: unknown) => {
          entry.partial = null;
          throw error;
        });
        if (!opened.ok) {
          entry.partial = null;
          return opened;
        }
        const first = load(key, entry, opened.signIn);
        if (entry.loadedAt === null) await first;
      }
      if (entry.loadedAt === null && entry.partial === null && entry.failed !== null)
        return { ok: false, error: entry.failed.error };
      return { ok: true, view: viewOf(entry) };
    },
    /** Drops a sign-in's people (it is gone or revoked). */
    forget(key: string): void {
      entries.delete(key);
    },
  };
}

export type SlackDirectory = ReturnType<typeof slackDirectory>;

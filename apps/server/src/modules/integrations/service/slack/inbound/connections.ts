import { owned, type SlackConnection } from '@mwc/db';
import type { SlackInboundStatus } from '@mwc/shared/enums';
import type { SlackSocket, SlackSocketHandlers, SlackSockets } from '@mwc/tools-core';
import type { Timers } from '../../../../../platform/jobs/runner.ts';
import { slackInboundRepo as repo } from '../../../repo/slack-inbound.ts';
import { receivingConnections } from '../../../repo/slack-inbound-all.ts';
import { botOf, recentKeys } from '../../../rules/slack/inbound/event.ts';
import { oneLine } from '../../../rules/slack/inbound/words.ts';
import { appTokenVersion, openAppToken } from './app-token.ts';
import type { Connection, HandleDeps } from './context.ts';
import { handleMessage } from './handle.ts';

/**
 * The server's Slack connections (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): one Socket Mode
 * connection per bot sign-in whose owner turned receiving on and gave its app-level token, in the server process that
 * runs the chats (with its background work, MWC_JOBS). At start, and every 5 minutes, it opens the ones that should be
 * open and closes the others; saving a sign-in's settings syncs that one at once. A connection opens the bot sign-in
 * for Socket Mode (`socket_mode`) and holds it for its messages' reads and notices, opened again when the sign-in
 * changes (Sign in again); its messages are handled one at a time (`handle.ts`), so two in one thread go to one chat.
 * Its status (connecting, connected, disconnected, or the error in words) is written on its row for the card.
 */

export const RESYNC_MS = 5 * 60_000;
/** The most messages a connection remembers having handled. */
export const SEEN_MAX = 2_000;

export interface ConnectionsDeps extends HandleDeps {
  readonly sockets: SlackSockets;
  readonly timers: Timers;
}

/** The connections' side the routes and `app.ts` use. */
export interface SlackInbound {
  /** Opens the connections that receive, then keeps them in sync every 5 minutes. */
  start(): Promise<void>;
  /** Opens, reopens (a new app token, a renewed sign-in) or closes one sign-in's connection by its settings now. */
  sync(credentialId: string, ownerUserId: string): Promise<void>;
  /** Closes every connection, for good. */
  stop(): void;
}

interface Live {
  readonly conn: Connection;
  readonly version: string | null;
  /** The sign-in as it was when the connection opened it (its `updated_at`). */
  readonly signedAt: string;
  socket?: SlackSocket;
  /** Its messages, one at a time; and its status writes, in order. */
  messages: Promise<void>;
  statuses: Promise<void>;
}

const logged = (deps: ConnectionsDeps, what: string) => (error: unknown) =>
  deps.logger.error({ err: error }, `slack inbound: ${what}`);

/** The connections of this process (see above), one per sign-in. */
class Connections implements SlackInbound {
  readonly #deps: ConnectionsDeps;
  readonly #live = new Map<string, Live>();
  #timer: unknown;
  #stopped = false;

  constructor(deps: ConnectionsDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    await this.#resync().catch(logged(this.#deps, 'could not sync the connections'));
    if (!this.#stopped) this.#schedule();
  }

  async sync(credentialId: string, ownerUserId: string): Promise<void> {
    const row = await repo.connectionOf(owned(this.#deps.db, ownerUserId), credentialId);
    const current = this.#live.get(credentialId);
    if (row === undefined || !row.inbound || this.#stopped) {
      this.#close(credentialId);
      if (row !== undefined && row.status !== 'off') await this.#status(row, 'off', null);
      return;
    }
    if (
      current !== undefined &&
      current.version === appTokenVersion(row) &&
      !(await this.#changed(row, current))
    )
      return;
    this.#close(credentialId);
    await this.#open(row);
  }

  stop(): void {
    this.#stopped = true;
    this.#deps.timers.clearTimeout(this.#timer);
    for (const credentialId of [...this.#live.keys()]) this.#close(credentialId);
  }

  #status(
    owner: Pick<SlackConnection, 'credentialId' | 'ownerUserId'>,
    status: SlackInboundStatus,
    message: string | null,
  ) {
    return repo.setStatus(this.#deps.db, owner, {
      status,
      statusMessage: message === null ? null : oneLine(message, 300),
      statusAt: this.#deps.clock(),
    });
  }

  #close(credentialId: string): void {
    this.#live.get(credentialId)?.socket?.close();
    this.#live.delete(credentialId);
  }

  /** Opens the row's connection: its app token, its bot sign-in (`socket_mode`), then Socket Mode; or says why not. */
  async #open(row: SlackConnection): Promise<void> {
    const deps = this.#deps;
    const owner = { credentialId: row.credentialId, ownerUserId: row.ownerUserId };
    let appToken: string | undefined;
    try {
      appToken = openAppToken(deps.keyring, row);
    } catch {
      return this.#status(
        owner,
        'error',
        'The app-level token does not open on this server: paste it again.',
      );
    }
    if (appToken === undefined) return;
    const opened = await deps.credentials.slackBot(row.credentialId, row.ownerUserId, {
      purpose: 'socket_mode',
    });
    if (!opened.ok) return this.#status(owner, 'error', opened.message);
    const conn: Connection = {
      ...owner,
      signIn: { token: opened.token },
      bot: botOf(opened.meta),
      seen: recentKeys(SEEN_MAX),
      notices: new Map(),
    };
    const entry: Live = {
      conn,
      version: appTokenVersion(row),
      signedAt: opened.updatedAt,
      messages: Promise.resolve(),
      statuses: Promise.resolve(),
    };
    this.#live.set(row.credentialId, entry);
    entry.socket = deps.sockets.open(appToken, this.#handlers(entry));
  }

  /** A connection's handlers: its statuses written in order while it is the sign-in's, its messages one at a time. */
  #handlers(entry: Live): SlackSocketHandlers {
    const { conn } = entry;
    return {
      onStatus: (status) => {
        if (this.#live.get(conn.credentialId) !== entry) return;
        entry.statuses = entry.statuses
          .then(() => this.#status(conn, status.state, status.message))
          .catch(logged(this.#deps, 'could not record a connection’s status'));
      },
      onMessage: (message) => {
        entry.messages = entry.messages
          .then(() => handleMessage(this.#deps, conn, message))
          .catch(logged(this.#deps, 'could not handle a message'));
        return entry.messages;
      },
    };
  }

  /** True when the sign-in changed since the connection opened it (or is gone). */
  async #changed(row: SlackConnection, entry: Live): Promise<boolean> {
    const sign = await repo.signInOf(owned(this.#deps.db, row.ownerUserId), row.credentialId);
    return sign === undefined || sign.updatedAt.toISOString() !== entry.signedAt;
  }

  async #resync(): Promise<void> {
    const rows = await receivingConnections(this.#deps.db);
    const wanted = new Set(rows.map((row) => row.credentialId));
    for (const credentialId of [...this.#live.keys()])
      if (!wanted.has(credentialId)) this.#close(credentialId);
    for (const row of rows)
      await this.sync(row.credentialId, row.ownerUserId).catch(
        logged(this.#deps, 'could not open a connection'),
      );
  }

  #schedule(): void {
    this.#timer = this.#deps.timers.setTimeout(async () => {
      await this.#resync().catch(logged(this.#deps, 'could not sync the connections'));
      if (!this.#stopped) this.#schedule();
    }, RESYNC_MS);
  }
}

/** The connections on these deps (see above). */
export function slackInbound(deps: ConnectionsDeps): SlackInbound {
  return new Connections(deps);
}

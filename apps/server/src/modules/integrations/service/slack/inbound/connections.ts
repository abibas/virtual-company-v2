import { owned, type SlackConnection } from '@mwc/db';
import type { SlackInboundStatus } from '@mwc/shared/enums';
import type { SlackSocket, SlackSockets } from '@mwc/tools-core';
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

/** The connections on these deps (see above). */
export function slackInbound(deps: ConnectionsDeps): SlackInbound {
  const live = new Map<string, Live>();
  let timer: unknown;
  let stopped = false;
  const failed = (what: string) => (error: unknown) =>
    deps.logger.error({ err: error }, `slack inbound: ${what}`);

  const writeStatus = (
    owner: Pick<SlackConnection, 'credentialId' | 'ownerUserId'>,
    status: SlackInboundStatus,
    message: string | null,
  ) =>
    repo.setStatus(deps.db, owner, {
      status,
      statusMessage: message === null ? null : oneLine(message, 300),
      statusAt: deps.clock(),
    });

  function close(credentialId: string): void {
    live.get(credentialId)?.socket?.close();
    live.delete(credentialId);
  }

  async function open(row: SlackConnection): Promise<void> {
    const owner = { credentialId: row.credentialId, ownerUserId: row.ownerUserId };
    let appToken: string | undefined;
    try {
      appToken = openAppToken(deps.keyring, row);
    } catch {
      return writeStatus(owner, 'error', 'The app-level token does not open on this server: paste it again.');
    }
    if (appToken === undefined) return;
    const opened = await deps.credentials.slackBot(row.credentialId, row.ownerUserId, {
      purpose: 'socket_mode',
    });
    if (!opened.ok) return writeStatus(owner, 'error', opened.message);
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
    live.set(row.credentialId, entry);
    entry.socket = deps.sockets.open(appToken, {
      onStatus: (status) => {
        if (live.get(row.credentialId) !== entry) return;
        entry.statuses = entry.statuses
          .then(() => writeStatus(owner, status.state, status.message))
          .catch(failed('could not record a connection’s status'));
      },
      onMessage: (message) => {
        entry.messages = entry.messages
          .then(() => handleMessage(deps, conn, message))
          .catch(failed('could not handle a message'));
        return entry.messages;
      },
    });
  }

  /** True when the sign-in changed since the connection opened it (or is gone). */
  async function signInChanged(row: SlackConnection, entry: Live): Promise<boolean> {
    const sign = await repo.signInOf(owned(deps.db, row.ownerUserId), row.credentialId);
    return sign === undefined || sign.updatedAt.toISOString() !== entry.signedAt;
  }

  async function sync(credentialId: string, ownerUserId: string): Promise<void> {
    const row = await repo.connectionOf(owned(deps.db, ownerUserId), credentialId);
    const current = live.get(credentialId);
    if (row === undefined || !row.inbound || stopped) {
      close(credentialId);
      if (row !== undefined && row.status !== 'off') await writeStatus(row, 'off', null);
      return;
    }
    if (
      current !== undefined &&
      current.version === appTokenVersion(row) &&
      !(await signInChanged(row, current))
    )
      return;
    close(credentialId);
    await open(row);
  }

  async function resync(): Promise<void> {
    const rows = await receivingConnections(deps.db);
    const wanted = new Set(rows.map((row) => row.credentialId));
    for (const credentialId of [...live.keys()]) if (!wanted.has(credentialId)) close(credentialId);
    for (const row of rows)
      await sync(row.credentialId, row.ownerUserId).catch(failed('could not open a connection'));
  }

  function schedule(): void {
    timer = deps.timers.setTimeout(async () => {
      await resync().catch(failed('could not sync the connections'));
      if (!stopped) schedule();
    }, RESYNC_MS);
  }

  return {
    async start() {
      await resync().catch(failed('could not sync the connections'));
      if (!stopped) schedule();
    },
    sync,
    stop() {
      stopped = true;
      deps.timers.clearTimeout(timer);
      for (const credentialId of [...live.keys()]) close(credentialId);
    },
  };
}

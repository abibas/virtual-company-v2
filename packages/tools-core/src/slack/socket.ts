/**
 * Slack's Socket Mode as the server receives it (2026-11-13, docs/subscriptions.md "Slack: receiving messages"): one
 * WebSocket per Slack app, opened with the app's app-level token (`xapp-`, scope `connections:write`), on which Slack
 * delivers the Events API's events with no public address needed. The connector (`connectors/slack`) acks each envelope
 * at once, drops the ones Slack sends again, reconnects with a backoff and when Slack asks it to, and hands the server
 * each message event once, read into `SlackInboundMessage`.
 */

/** A message event Slack delivered: a mention of the bot (`app_mention`) or a message of a channel or a DM. */
export interface SlackInboundMessage {
  /** The Events API's id (`Ev…`); null when the envelope had none. */
  readonly eventId: string | null;
  /** The workspace it came from (`T…`). */
  readonly teamId: string | null;
  readonly type: 'app_mention' | 'message';
  /** The conversation's id (`C…`, `G…`, `D…`). */
  readonly channel: string;
  /** `channel`, `group`, `im` or `mpim`; null when Slack does not say (an `app_mention`). */
  readonly channelType: string | null;
  /** Its author (`U…`); null for some bots' messages. */
  readonly user: string | null;
  /** Set when a bot wrote it. */
  readonly botId: string | null;
  /** Slack's subtype (`bot_message`, `message_changed`, `thread_broadcast`, …); null for a person's plain message. */
  readonly subtype: string | null;
  /** Its text as Slack sends it: mentions as `<@U…>`, channels as `<#C…|name>`. */
  readonly text: string;
  readonly ts: string;
  /** The thread it is in (its parent's `ts`); null outside a thread. */
  readonly threadTs: string | null;
  /** It was edited (`edited` set). */
  readonly edited: boolean;
}

/** Where a connection is: opening, open (Slack said hello), closed and waiting to try again, or stopped by a refusal. */
export type SlackSocketState = 'connecting' | 'connected' | 'disconnected' | 'error';

/** A connection's state, with what happened in words (null while connecting or connected). */
export interface SlackSocketStatus {
  readonly state: SlackSocketState;
  readonly message: string | null;
}

/** What a connection tells the server. */
export interface SlackSocketHandlers {
  /** A message event, already acked, once per envelope and event id (what it returns is not waited for). */
  readonly onMessage: (message: SlackInboundMessage) => void | Promise<void>;
  /** Its state changed. */
  readonly onStatus: (status: SlackSocketStatus) => void;
}

/** One open connection; `close` ends it for good. */
export interface SlackSocket {
  close(): void;
}

/** Opens Socket Mode connections. */
export interface SlackSockets {
  /** Connects with an app-level token, acks and dedupes, reconnects until closed (see above). */
  open(appToken: string, handlers: SlackSocketHandlers): SlackSocket;
}

import type { SlackInboundMessage, SlackSocketStatus } from '@mwc/tools-core';
import type { SocketLike, SocketTimers } from '../../src/socket.ts';

/**
 * A fake Socket Mode server for the connection's tests: each WebSocket the connection opens is a `FakeSocket` the test
 * speaks for Slack through (`say`, `hello`, `closeFromSlack`), recording what the connection sent; and timers fired by
 * hand. Nothing reaches Slack.
 */

/** One connection as the fake server holds it. */
export class FakeSocket implements SocketLike {
  readonly url: string;
  readonly sent: unknown[] = [];
  closedWith: number | undefined;
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number): void {
    this.closedWith = code ?? 1005;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  /** Slack sends a frame (an object as JSON, a string as it is). */
  say(frame: unknown): void {
    this.#emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  hello(): void {
    this.say({ type: 'hello', num_connections: 1 });
  }

  /** Slack drops the connection. */
  closeFromSlack(): void {
    this.#emit('error', {});
    this.#emit('close', { code: 1006 });
  }
}

/** The fake server: every socket opened, the latest last. */
export function fakeServer() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    webSocket: (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    get latest(): FakeSocket {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error('no socket opened');
      return socket;
    },
  };
}

/** Timers fired by hand: each pending one with its wait. */
export function handTimers() {
  let next = 0;
  const pending = new Map<number, { readonly callback: () => void; readonly ms: number }>();
  const timers: SocketTimers = {
    setTimeout(callback, ms) {
      next++;
      pending.set(next, { callback, ms });
      return next;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    /** The waits pending, oldest first. */
    waits: () => [...pending.values()].map((one) => one.ms),
    /** Fires the pending timer of this wait (the oldest when several). */
    fire(ms: number): void {
      const found = [...pending.entries()].find(([, one]) => one.ms === ms);
      if (found === undefined) throw new Error(`no timer of ${ms} ms pending (${timersWords(pending)})`);
      pending.delete(found[0]);
      found[1].callback();
    },
  };
}

const timersWords = (pending: Map<number, { readonly ms: number }>) =>
  [...pending.values()].map((one) => `${one.ms} ms`).join(', ') || 'none';

/** What a connection told: its statuses and messages, in order. */
export function recorder() {
  const statuses: SlackSocketStatus[] = [];
  const messages: SlackInboundMessage[] = [];
  return {
    statuses,
    messages,
    handlers: {
      onStatus: (s: SlackSocketStatus) => {
        statuses.push(s);
      },
      onMessage: (m: SlackInboundMessage) => {
        messages.push(m);
      },
    },
    /** The states told so far. */
    states: () => statuses.map((s) => s.state),
  };
}

/** An Events API envelope carrying this event. */
export const envelope = (envelopeId: string, eventId: string, event: Record<string, unknown>) => ({
  type: 'events_api',
  envelope_id: envelopeId,
  accepts_response_payload: false,
  payload: { type: 'event_callback', team_id: 'T0AIRIA', event_id: eventId, event },
});

/** A person's message in #general. */
export const mention = (ts = '1731490000.000100', extra: Record<string, unknown> = {}) => ({
  type: 'app_mention',
  channel: 'C0GENERAL1',
  user: 'U0IHOR',
  text: '<@U0BOT> Bro are you there?',
  ts,
  ...extra,
});

/** Lets pending promises (the address fetched) settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

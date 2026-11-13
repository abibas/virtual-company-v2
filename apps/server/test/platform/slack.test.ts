import type { SlackSocketStatus } from '@mwc/tools-core';
import { describe, expect, it } from 'vitest';
import { slackSocketsFor } from '../../src/platform/slack.ts';
import { FakeProvider, json } from '../fixtures/credentials/providers.ts';

/**
 * Socket Mode as the server wires it (2026-11-13): `apps.connections.open` through the provider client and the WebSocket
 * class given (the platform's in the server), never a real Slack.
 */

class RecordingSocket {
  static opened: string[] = [];
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    RecordingSocket.opened.push(url);
  }
  send(): void {}
  close(): void {}
  addEventListener(): void {}
}

describe('Socket Mode through the provider client', () => {
  it('asks Slack for the address with the app token and opens a socket of the class given there', async () => {
    const provider = new FakeProvider();
    const url = 'wss://wss-primary.slack.com/link/?ticket=t';
    provider.route('POST', 'https://slack.com/api/apps.connections.open', json(200, { ok: true, url }));
    const statuses: SlackSocketStatus[] = [];
    const socket = slackSocketsFor(provider.fetch, RecordingSocket).open('xapp-1-A0-123456789-x', {
      onStatus: (status) => {
        statuses.push(status);
      },
      onMessage: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(provider.calls[0]?.headers.authorization).toBe('Bearer xapp-1-A0-123456789-x');
    expect(RecordingSocket.opened).toEqual([url]);
    expect(statuses.map((status) => status.state)).toEqual(['connecting']);
    socket.close();
  });
});

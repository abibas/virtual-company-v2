import type { ChatTurn } from '@mwc/db';

/**
 * Who a turn Most Wanted queued speaks for (2026-11-13, docs/harness.md "Live chat lists"), pure: a Slack message's turn
 * (docs/subscriptions.md "Slack: receiving messages") begins with its header line, "Slack message from <name> in
 * <place> (<link>). Your final reply is posted …", and shows as that person's message via Slack; any other turn names
 * nobody here (a person's own is its writer's, a wake-up Most Wanted's).
 */

/** The person a Slack message's turn came from. */
export interface TurnSender {
  readonly name: string;
  readonly via: 'slack';
}

/** The header of a Slack message's prompt; the place never holds " in ", so the name is everything before it. */
const SLACK_HEADER =
  /^Slack message from (.+) in (?:#\S+|a DM with you|a group DM)(?: \([^)]*\))?\. Your final reply is posted (?:in that thread|there) under your name\.$/;

/** The Slack person a turn Most Wanted queued came from; null for any other turn. */
export function senderOf(turn: Pick<ChatTurn, 'system' | 'kind' | 'prompt'>): TurnSender | null {
  if (!turn.system || turn.kind !== 'message') return null;
  const name = SLACK_HEADER.exec(turn.prompt.split('\n', 1)[0] ?? '')?.[1]?.trim();
  return name ? { name, via: 'slack' } : null;
}

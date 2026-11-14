import type { ContactInteraction } from '../../../api/contacts.ts';

/**
 * The org chart's Requesters (2026-11-14, docs/subscriptions.md "Contacts"): the contacts who talked to the company's
 * agents, in a column beside the tree. Which window they count over, how the address remembers the column
 * (`?requesters=0` hides it, `24h` or `30d` picks another window than the 7 days), and their order.
 */

export type RequesterWindow = '24h' | '7d' | '30d';

const HOUR_MS = 3_600_000;

/** Each window: its menu item, its words on a card ("12 requests · 7 days") and its length. */
export const WINDOWS: Readonly<
  Record<RequesterWindow, { readonly label: string; readonly span: string; readonly ms: number }>
> = {
  '24h': { label: 'Last 24 hours', span: '24 hours', ms: 24 * HOUR_MS },
  '7d': { label: 'Last 7 days', span: '7 days', ms: 7 * 24 * HOUR_MS },
  '30d': { label: 'Last 30 days', span: '30 days', ms: 30 * 24 * HOUR_MS },
};

export const WINDOW_ORDER: readonly RequesterWindow[] = ['24h', '7d', '30d'];

/** The address's word for the column. */
export const REQUESTERS_PARAM = 'requesters';

const DEFAULT_WINDOW: RequesterWindow = '7d';
const HIDDEN = '0';

export interface RequestersChoice {
  readonly shown: boolean;
  readonly window: RequesterWindow;
}

/** The column as the address has it: shown over 7 days unless `?requesters=` says otherwise. */
export function requestersAt(value: string | null): RequestersChoice {
  if (value === HIDDEN) return { shown: false, window: DEFAULT_WINDOW };
  const window = WINDOW_ORDER.find((w) => w === value) ?? DEFAULT_WINDOW;
  return { shown: true, window };
}

/** The address's value for a choice, or null for the default (shown, 7 days), which the address leaves out. */
export function requestersValue(choice: RequestersChoice): string | null {
  if (!choice.shown) return HIDDEN;
  return choice.window === DEFAULT_WINDOW ? null : choice.window;
}

/** A contact's messages to all the agents in the window. */
export const requestsOf = (contact: ContactInteraction): number =>
  contact.agents.reduce((sum, agent) => sum + agent.messages, 0);

const latestOf = (contact: ContactInteraction): number =>
  Math.max(0, ...contact.agents.map((agent) => Date.parse(agent.lastAt)));

/** The busiest first: those being answered now, then by their requests, then the latest. */
export function rankRequesters(contacts: readonly ContactInteraction[]): ContactInteraction[] {
  return [...contacts].sort(
    (a, b) => Number(b.live) - Number(a.live) || requestsOf(b) - requestsOf(a) || latestOf(b) - latestOf(a),
  );
}

import type { ContactInteraction } from '../../../api/contacts.ts';
import { CARD, type ChartLayout } from '../../../components/org/layout.ts';
import { rankRequesters, requestsOf } from './requesters.ts';

/**
 * Where the Requesters sit on the chart, pure: a column to the right of the tree, aligned to its top (the tree grows
 * down from the company in the middle, and the zoom buttons stay over the canvas's right edge, not over a card), its
 * label first, the busiest contacts down it (at most `COLUMN.max`, then "+N more"), and a dashed curve from each card's
 * left edge to the right edge of each agent card they talked to, wider the more messages.
 */

/** A contact's card, in chart pixels. */
export const REQUESTER = { width: 208, height: 72 } as const;

/** The room between the tree and the column (the curves), the label's height, the space between cards, the cap. */
export const COLUMN = { gap: 128, label: 28, row: 12, more: 32, max: 12 } as const;

/** One link from a contact to an agent. */
export interface RequesterLink {
  /** `contactId>principalId`. */
  readonly key: string;
  readonly contactId: string;
  readonly principalId: string;
  /** The curve's SVG path. */
  readonly d: string;
  /** 1 to 4 px, by the messages. */
  readonly width: number;
  readonly messages: number;
  readonly live: boolean;
}

export interface PlacedRequester {
  readonly contact: ContactInteraction;
  readonly requests: number;
  readonly x: number;
  readonly y: number;
}

export interface RequestersLayout {
  /** The column's left edge. */
  readonly x: number;
  readonly cards: readonly PlacedRequester[];
  /** "+N more", under the last card, when some did not fit. */
  readonly more: { readonly x: number; readonly y: number; readonly count: number } | undefined;
  readonly links: readonly RequesterLink[];
  /** The whole chart with the column, in chart pixels. */
  readonly width: number;
  readonly height: number;
}

/** From this many messages a link is at its widest. */
const WIDEST_FROM = 16;

/** A link's width: 1 px for one message, up to 4 px at the busiest (or 16 messages), on a log scale. */
export function linkWidth(messages: number, busiest: number): number {
  const top = Math.log(Math.max(WIDEST_FROM, busiest));
  const width = 1 + (3 * Math.log(Math.max(1, messages))) / top;
  return Math.round(Math.min(4, width) * 100) / 100;
}

/** A curve leaving a card's left edge sideways and reaching an agent card's right edge sideways. */
export function linkPath(from: readonly [number, number], to: readonly [number, number]): string {
  const bend = Math.max(64, (from[0] - to[0]) * 0.45);
  return `M ${from[0]} ${from[1]} C ${from[0] - bend} ${from[1]} ${to[0] + bend} ${to[1]} ${to[0]} ${to[1]}`;
}

/** The column and its links beside `chart` (the tree), or undefined when nobody talked to an agent in the window. */
export function layoutRequesters(
  chart: ChartLayout,
  contacts: readonly ContactInteraction[],
): RequestersLayout | undefined {
  if (contacts.length === 0) return undefined;
  const ranked = rankRequesters(contacts);
  const shown = ranked.slice(0, COLUMN.max);
  const x = chart.width + COLUMN.gap;
  const cards = shown.map((contact, index) => ({
    contact,
    requests: requestsOf(contact),
    x,
    y: COLUMN.label + index * (REQUESTER.height + COLUMN.row),
  }));
  const bottom = COLUMN.label + shown.length * (REQUESTER.height + COLUMN.row) - COLUMN.row;
  const hidden = ranked.length - shown.length;
  const more = hidden > 0 ? { x, y: bottom + COLUMN.row, count: hidden } : undefined;
  const placed = new Map(chart.cards.map((card) => [card.id, card]));
  const busiest = Math.max(...shown.flatMap((contact) => contact.agents.map((agent) => agent.messages)));
  const links = cards.flatMap((card) =>
    card.contact.agents.flatMap((agent) => {
      const at = placed.get(agent.principalId);
      if (!at) return [];
      const from = [x, card.y + REQUESTER.height / 2] as const;
      const to = [at.x + CARD.width, at.y + CARD.height / 2] as const;
      return [
        {
          key: `${card.contact.contact.id}>${agent.principalId}`,
          contactId: card.contact.contact.id,
          principalId: agent.principalId,
          d: linkPath(from, to),
          width: linkWidth(agent.messages, busiest),
          messages: agent.messages,
          live: agent.live,
        },
      ];
    }),
  );
  const columnBottom = more ? more.y + COLUMN.more : bottom;
  return {
    x,
    cards,
    more,
    links,
    width: x + REQUESTER.width,
    height: Math.max(chart.height, columnBottom),
  };
}

/** What a hover or a highlighted flow lights up: these contacts, agents and links; the rest fades. */
export interface RequestersLit {
  readonly contacts: ReadonlySet<string>;
  readonly principals: ReadonlySet<string>;
  readonly links: ReadonlySet<string>;
}

/** What hovering lights: a contact (their links and agents), or an agent (its requesters), else nothing. */
export type RequesterHover =
  | { readonly kind: 'contact'; readonly id: string }
  | { readonly kind: 'agent'; readonly id: string };

/**
 * What is lit by a hover, or by a highlighted flow's members (the requesters who talked to them), or undefined when
 * nothing fades: no hover, no flow, or an agent hovered that nobody talked to.
 */
export function litBy(
  layout: RequestersLayout,
  hover: RequesterHover | undefined,
  members?: { has(id: string): boolean },
): RequestersLit | undefined {
  const lit = (keep: (link: RequesterLink) => boolean) => {
    const links = layout.links.filter(keep);
    return {
      contacts: new Set(links.map((link) => link.contactId)),
      principals: new Set(links.map((link) => link.principalId)),
      links: new Set(links.map((link) => link.key)),
    };
  };
  if (hover?.kind === 'contact') {
    const shown = lit((link) => link.contactId === hover.id);
    return { ...shown, contacts: new Set([hover.id]) };
  }
  if (hover?.kind === 'agent') {
    const shown = lit((link) => link.principalId === hover.id);
    return shown.links.size > 0 ? shown : undefined;
  }
  return members ? lit((link) => members.has(link.principalId)) : undefined;
}

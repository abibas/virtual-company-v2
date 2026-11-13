import type { SlackRights } from '@mwc/shared/credentials';
import { channelInScope } from '../rights.ts';
import type { Place } from './words.ts';

/**
 * Whether an agent answers a Slack message where it is (2026-11-13), by the rights of its profile's Slack part as its
 * token lets them work: a channel outside the part's channels, or a DM with DMs off, is ignored quietly; a channel in
 * them without read and post, a DM without the DM right `post`, or no Slack part on this sign-in at all, is refused (a
 * notice says so once). Pure.
 */

export type Reach = 'answer' | 'ignore' | 'refuse';

/** The agent's reach there; `rights` undefined: its profile has no Slack part on this sign-in. */
export function inboundReach(rights: SlackRights | undefined, place: Place): Reach {
  if (rights === undefined) return 'refuse';
  if (place.dm) {
    if (rights.dms === 'off') return 'ignore';
    return rights.dms === 'post' ? 'answer' : 'refuse';
  }
  if (!channelInScope(rights.channels, { id: place.id, name: place.name, dm: false })) return 'ignore';
  return rights.read && rights.post ? 'answer' : 'refuse';
}

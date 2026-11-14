import { useRef } from 'react';
import { type ContactInteraction, useContactInteractions, useHasContacts } from '../../../api/contacts.ts';
import { useRequestersChoice } from './RequestersToggle.tsx';
import { type RequesterWindow, WINDOWS } from './requesters.ts';

/** The Requesters the org chart draws, and where their cards lead. */
export interface ChartRequesters {
  /** Who talked to which agent in the window; undefined until first read (the canvas waits, so its first fit holds them). */
  readonly contacts: readonly ContactInteraction[] | undefined;
  readonly window: RequesterWindow;
  /** A contact's page. */
  contactHref(contactId: string): string;
  /** The Contacts tab ("+N more"). */
  readonly moreHref: string;
}

/**
 * The org chart's Requesters for the structure page: offered (the switch in the header row) when the viewer may read
 * contacts (`enabled`) and the company has any; drawn while the address does not hide them (`?requesters=0`), over the
 * window it picks, read again live (`useContactInteractions`). While another window loads the last answer stays, so
 * the column does not flash away.
 */
export function useRequesters(
  companyId: string,
  enabled: boolean,
  links: { readonly contactHref: (contactId: string) => string; readonly moreHref: string },
): { readonly offered: boolean; readonly chart: ChartRequesters | undefined } {
  const choice = useRequestersChoice();
  const any = useHasContacts(companyId, enabled);
  const read = enabled && choice.shown && any !== false;
  const interactions = useContactInteractions(companyId, read, WINDOWS[choice.window].ms);
  const last = useRef<readonly ContactInteraction[]>(undefined);
  if (!read) last.current = undefined;
  else if (interactions.data) last.current = interactions.data.contacts;
  else if (interactions.error !== undefined && !last.current) last.current = [];
  if (!read) return { offered: any === true, chart: undefined };
  return {
    offered: any === true,
    chart: { contacts: any === undefined ? undefined : last.current, window: choice.window, ...links },
  };
}

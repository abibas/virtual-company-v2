import type { InferRequestType, InferResponseType } from 'hono/client';
import { useEffect, useRef } from 'react';
import { useChatActivity } from './chat-activity.ts';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A company's contacts (2026-11-14, docs/subscriptions.md "Contacts"): the people outside it who talked to its agents.
 * The list (`GET …/contacts`, archived ones with `archived`), a contact's page (`GET …/contacts/:contactId`: their
 * conversations with the agents and the counts per agent), read again when the company's chats' activity tells a turn of
 * theirs or one of their conversations moved, and the change admins make (`PATCH`: the note, archived).
 */

type ContactRoutes = Api['api']['companies'][':companyId']['contacts'];
type OneContact = ContactRoutes[':contactId'];

export type ContactListItem = InferResponseType<ContactRoutes['$get'], 200>['contacts'][number];
export type ContactDetail = InferResponseType<OneContact['$get'], 200>;
export type Contact = ContactDetail['contact'];
export type ContactConversation = ContactDetail['conversations'][number];
export type ContactAgentCount = ContactDetail['agents'][number];
export type ContactChange = InferRequestType<OneContact['$patch']>['json'];
export type ContactInteractions = InferResponseType<ContactRoutes['interactions']['$get'], 200>;
export type ContactInteraction = ContactInteractions['contacts'][number];

/** How long a burst of the activity's messages is gathered before the page is read again. */
const BURST_MS = 300;

/** The company's contacts, the latest seen first; archived ones too with `archived`. */
export function useContacts(
  companyId: string,
  archived: boolean,
): Loaded<{ readonly contacts: readonly ContactListItem[] }> {
  const api = useApi();
  return useLoad(`contacts:${companyId}:${archived}`, () =>
    call(
      api.api.companies[':companyId'].contacts.$get({
        param: { companyId },
        query: archived ? { archived: 'true' } : {},
      }),
    ),
  );
}

/** A contact's page, followed live (see above). */
export function useContact(companyId: string, contactId: string): Loaded<ContactDetail> {
  const api = useApi();
  const loaded = useLoad(`contact:${companyId}:${contactId}`, () =>
    call(api.api.companies[':companyId'].contacts[':contactId'].$get({ param: { companyId, contactId } })),
  );
  const { reload, data } = loaded;
  const burst = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(burst.current), []);
  const soon = () => {
    clearTimeout(burst.current);
    burst.current = setTimeout(reload, BURST_MS);
  };
  useChatActivity(companyId, true, {
    chat: ({ chat, lastTurn }) => {
      const theirs = lastTurn?.from?.contactId === contactId;
      if (theirs || data?.conversations.some((conversation) => conversation.chatId === chat.id)) soon();
    },
    opened: soon,
  });
  return loaded;
}

/** Changes a contact's note or archives it (admins and owners); the contact as it is now. */
export function useContactChange(companyId: string) {
  const api = useApi();
  return (contactId: string, change: ContactChange): Promise<Contact> =>
    call(
      api.api.companies[':companyId'].contacts[':contactId'].$patch({
        param: { companyId, contactId },
        json: change,
      }),
    );
}

/** How long the activity's messages are gathered before the org chart's Requesters are read again. */
const INTERACTIONS_BURST_MS = 1000;

/**
 * Who talked to which agent since `sinceMs` milliseconds ago (the org chart's Requesters), read again a moment after the
 * company's chats' activity tells a turn from a contact started, moved or ended, and on each open of the stream (no
 * polling). Nothing is read while not `enabled` (the column hidden, a viewer).
 */
export function useContactInteractions(
  companyId: string,
  enabled: boolean,
  sinceMs: number,
): Loaded<ContactInteractions | undefined> {
  const api = useApi();
  const loaded = useLoad(enabled ? `interactions:${companyId}:${sinceMs}` : 'interactions:off', () =>
    enabled
      ? call(
          api.api.companies[':companyId'].contacts.interactions.$get({
            param: { companyId },
            query: { since: new Date(Date.now() - sinceMs).toISOString() },
          }),
        )
      : Promise.resolve(undefined),
  );
  const { reload } = loaded;
  const burst = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(burst.current), []);
  const soon = () => {
    clearTimeout(burst.current);
    burst.current = setTimeout(reload, INTERACTIONS_BURST_MS);
  };
  useChatActivity(companyId, enabled, {
    chat: ({ lastTurn }) => {
      if (lastTurn?.from?.contactId) soon();
    },
    opened: soon,
  });
  return loaded;
}

/**
 * Whether the company has any contact (not archived): the org chart offers its Requesters only then. Undefined while it
 * is read; false when not `enabled` or the read failed.
 */
export function useHasContacts(companyId: string, enabled: boolean): boolean | undefined {
  const api = useApi();
  const loaded = useLoad(enabled ? `contacts:any:${companyId}` : 'contacts:any:off', () =>
    enabled
      ? call(api.api.companies[':companyId'].contacts.$get({ param: { companyId }, query: {} }))
      : Promise.resolve(undefined),
  );
  if (!enabled || loaded.error !== undefined) return false;
  return loaded.data === undefined ? undefined : loaded.data.contacts.length > 0;
}

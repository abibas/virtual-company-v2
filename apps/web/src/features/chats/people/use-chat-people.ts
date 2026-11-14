import { useState } from 'react';
import type { ChatCalls } from '../../../api/chats.ts';
import { useOrgChart } from '../../../api/org.ts';
import type { ChatDetail, ChatPerson } from '../../../api/types.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { useCompany } from '../../../app/company.ts';
import { navigate } from '../../../app/router.tsx';
import type { PeopleActions } from './PeopleSheet.tsx';
import { readerPrincipal } from './people-model.ts';

/**
 * The open chat's people (2026-11-14, docs/harness.md "Who is in a chat"): who is in it (the detail's, then each change
 * made here at once), whether the reader only looks on as an owner (the owner view), the reader's place on the chart,
 * and the changes: an owner's Add me reads the chat again (out of the owner view); leaving it goes back to the list.
 */
export function useChatPeople(calls: ChatCalls, detail: Loaded<ChatDetail>, chatId: string, owner: boolean) {
  const { membership, me } = useCompany();
  const chart = useOrgChart(membership.companyId);
  const base = detail.data;
  const [changed, setChanged] = useState<{
    readonly base: unknown;
    readonly people: readonly ChatPerson[];
  }>();
  const people = changed?.base === base && changed !== undefined ? changed.people : (base?.people ?? []);
  const looksOn = base?.ownerView === true;
  const reader = { principalId: readerPrincipal(chart.data?.nodes, me.user.id), owner };
  const actions: PeopleActions = {
    add: async (principalIds) => {
      const after = await calls.addPeople(chatId, principalIds);
      setChanged({ base, people: after.people });
      if (looksOn) detail.reload();
    },
    remove: async (personId) => {
      const gone = people.find((person) => person.id === personId);
      const after = await calls.removePerson(chatId, personId);
      setChanged({ base, people: after.people });
      if (gone?.principalId !== undefined && gone.principalId === reader.principalId)
        navigate(window.location.pathname, { replace: true });
    },
  };
  const message = base !== undefined && base.task === null && base.flowId === null;
  return { people, looksOn, reader, actions, nodes: chart.data?.nodes, message, slack: base?.slack ?? null };
}

export type ChatPeople = ReturnType<typeof useChatPeople>;

import type { ChatTurn } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import {
  agentCounts,
  conversationsOf,
  lastMessage,
} from '../../../../src/modules/contacts/rules/conversations.ts';
import { interactionsOf } from '../../../../src/modules/contacts/rules/interactions.ts';

/**
 * A contact's conversations and interactions (2026-11-14), the edges the routes do not reach: a turn that is neither a
 * reply nor a message from outside, a long reply cut, and a chat or agent the reads no longer find.
 */

const at = new Date(Date.UTC(2026, 10, 14, 9));
const turn = (fields: Partial<ChatTurn>) =>
  ({
    status: 'done',
    resultText: null,
    endedAt: null,
    createdAt: at,
    system: false,
    kind: 'message',
    prompt: 'What is 2 + 2?',
    sender: null,
    contactId: null,
    visibleText: null,
    ...fields,
  }) as ChatTurn;

describe('lastMessage', () => {
  it('is the agent’s reply on one line, cut; a person’s own prompt or a failed turn of theirs gives none', () => {
    const long = `${'word '.repeat(100)}end`;
    const reply = lastMessage(turn({ resultText: long, endedAt: at }));
    expect(reply).toMatchObject({ by: 'agent', at: at.toISOString() });
    expect(reply?.text).toHaveLength(300);
    expect(reply?.text.endsWith('…')).toBe(true);
    expect(lastMessage(turn({ status: 'failed', resultText: 'partial' }))).toBeNull();
    expect(lastMessage(turn({ resultText: '   ' }))).toBeNull();
  });
});

describe('conversationsOf, agentCounts and interactionsOf', () => {
  const chat = { id: 'c1', agentId: 'gone', title: null, updatedAt: at, archivedAt: null };
  const row = { contactId: 'k1', chatId: 'c1', messages: 1, lastAt: at, live: false };

  it('leave out a chat whose agent, or a row whose chat, agent or contact, the reads no longer find', () => {
    const empty = { agents: new Map(), places: new Map(), latest: new Map(), live: new Set<string>() };
    expect(conversationsOf({ ...empty, chats: [chat] })).toEqual([]);
    expect(agentCounts([row, { ...row, chatId: 'c2' }], new Map([['c1', chat]]), new Map())).toEqual([]);
    const reads = { chats: new Map([['c1', chat]]), agents: new Map(), contacts: new Map() };
    expect(interactionsOf([row, { ...row, chatId: 'c2' }], reads)).toEqual([]);
  });
});

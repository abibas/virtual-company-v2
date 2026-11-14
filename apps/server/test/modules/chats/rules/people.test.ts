import { describe, expect, it } from 'vitest';
import {
  editedPrompt,
  groupPrompt,
  isMessageChat,
  mayJoin,
  mayRemove,
  peopleLine,
  promptTooLong,
  seatOf,
} from '../../../../src/modules/chats/rules/people.ts';

/** Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"), its pure rules. */

const message = { taskId: null, flowId: null };

describe('where a member stands in a chat', () => {
  it('is in a message chat they are in; an owner who is not reads it; anyone else nowhere', () => {
    expect(isMessageChat(message)).toBe(true);
    expect(seatOf(message, true, 'member')).toBe('in');
    expect(seatOf(message, false, 'owner')).toBe('owner');
    for (const role of ['admin', 'member', 'viewer'] as const)
      expect(seatOf(message, false, role)).toBe('none');
  });

  it("keeps a task's conversation and a team chat to their own rules", () => {
    for (const chat of [
      { taskId: 't', flowId: null },
      { taskId: null, flowId: 'f' },
    ]) {
      expect(isMessageChat(chat)).toBe(false);
      expect(seatOf(chat, false, 'member')).toBe('open');
    }
  });

  it('takes active members above a viewer only', () => {
    expect(mayJoin({ role: 'member', status: 'active' })).toBe(true);
    expect(mayJoin({ role: 'viewer', status: 'active' })).toBe(false);
    expect(mayJoin({ role: 'owner', status: 'suspended' })).toBe(false);
  });
});

describe('the changes of a chat’s people', () => {
  it('lets anyone leave, and the creator or an owner take someone else out', () => {
    const chat = { createdBy: 'creator' };
    expect(mayRemove({ principalId: 'anna', role: 'member' }, chat, { principalId: 'anna' })).toBe(true);
    expect(mayRemove({ principalId: 'anna', role: 'admin' }, chat, { principalId: 'bob' })).toBe(false);
    expect(mayRemove({ principalId: 'creator', role: 'member' }, chat, { principalId: null })).toBe(true);
    expect(mayRemove({ principalId: 'boss', role: 'owner' }, chat, { principalId: 'bob' })).toBe(true);
  });

  it('says each change in a quiet line', () => {
    expect(peopleLine('added', 'Ihor', 'Anna')).toBe('Ihor added Anna');
    expect(peopleLine('removed', 'Ihor', 'Erich')).toBe('Ihor removed Erich');
    expect(peopleLine('left', 'Anna', 'Anna')).toBe('Anna left the chat');
    expect(peopleLine('joined', 'Ihor', 'Ihor')).toBe('Ihor joined the chat');
  });
});

describe("a group chat's prompt", () => {
  it('names its writer first, unless it no longer fits; the refusal says by how much', () => {
    expect(groupPrompt('Anna', 'Hi')).toBe('Message from Anna:\n\nHi');
    expect(groupPrompt('Anna', 'x'.repeat(20_000))).toBeUndefined();
    expect(promptTooLong(19).message).toContain('by 19 characters');
  });

  it('keeps the header on an edit, and a prompt without one as written', () => {
    const named = { prompt: 'Message from Anna:\n\nHi', visibleText: 'Hi', system: false };
    expect(editedPrompt(named, 'Hello')).toEqual({
      prompt: 'Message from Anna:\n\nHello',
      visibleText: 'Hello',
    });
    expect(editedPrompt({ prompt: 'Hi', visibleText: null, system: false }, 'Hello')).toEqual({
      prompt: 'Hello',
    });
    expect(editedPrompt({ ...named, system: true }, 'Hello')).toEqual({ prompt: 'Hello' });
    expect(editedPrompt({ ...named, visibleText: 'other' }, 'Hello')).toEqual({ prompt: 'Hello' });
  });
});

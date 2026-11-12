import { describe, expect, it } from 'vitest';
import {
  CURSOR_PATTERN,
  cursorOf,
  cursorText,
  likeLiteral,
  STATES_PATTERN,
  searchOf,
  statesOf,
} from '../../../../src/modules/tasks/rules/list.ts';

describe('the task list query', () => {
  it('reads one state or several, each once, and refuses anything else', () => {
    expect(statesOf('active')).toEqual(['active']);
    expect(statesOf('queued,active,escalated,active')).toEqual(['queued', 'active', 'escalated']);
    for (const ok of ['done', 'queued,cancelled']) expect(STATES_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'open', 'active,', ',active', 'active,,done', 'Active']) {
      expect(STATES_PATTERN.test(bad)).toBe(false);
    }
  });

  it('searches by a key or a number and by a part of the title', () => {
    expect(searchOf(undefined)).toBeUndefined();
    expect(searchOf('   ')).toBeUndefined();
    expect(searchOf(' t-12 ')).toEqual({ number: 12, title: 't-12' });
    expect(searchOf('12')).toEqual({ number: 12, title: '12' });
    expect(searchOf('login')).toEqual({ number: undefined, title: 'login' });
    expect(searchOf('012')).toEqual({ number: undefined, title: '012' });
  });

  it('takes LIKE wildcards literally', () => {
    expect(likeLiteral('50%_off\\now')).toBe('50\\%\\_off\\\\now');
  });

  it('writes and reads a cursor', () => {
    const cursor = { updatedAt: new Date('2026-11-12T10:00:00.123Z'), number: 7 };
    const text = cursorText(cursor);
    expect(text).toBe(`${cursor.updatedAt.getTime()}.7`);
    expect(CURSOR_PATTERN.test(text)).toBe(true);
    expect(cursorOf(text)).toEqual(cursor);
    for (const bad of ['', '7', '1.0', 'a.1', '1.2.3']) expect(CURSOR_PATTERN.test(bad)).toBe(false);
  });
});

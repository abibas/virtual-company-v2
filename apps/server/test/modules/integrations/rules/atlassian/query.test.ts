import { describe, expect, it } from 'vitest';
import { readQuery, scopedQuery } from '../../../../../src/modules/integrations/rules/atlassian/query.ts';

describe('a search kept inside the profile’s projects or spaces', () => {
  it('ANDs the query with the keys, its ORDER BY kept last', () => {
    expect(
      scopedQuery('assignee = currentUser() ORDER BY updated DESC', 'project', ['AP', 'SS'], 'JQL'),
    ).toEqual({
      ok: true,
      query: 'project in ("AP", "SS") AND (assignee = currentUser()) ORDER BY updated DESC',
    });
    expect(scopedQuery('type = page order  by created', 'space', ['ENG'], 'CQL')).toEqual({
      ok: true,
      query: 'space in ("ENG") AND (type = page) order  by created',
    });
  });

  it('keeps a query of an ORDER BY alone, or empty, to the scope only', () => {
    expect(scopedQuery('ORDER BY created DESC', 'project', ['AP'], 'JQL')).toEqual({
      ok: true,
      query: 'project in ("AP") ORDER BY created DESC',
    });
    expect(scopedQuery('  ', 'space', ['~abc'], 'CQL')).toEqual({ ok: true, query: 'space in ("~abc")' });
  });

  it('leaves a query as it is for every project, once it reads well', () => {
    expect(scopedQuery('project = X', 'project', 'all', 'JQL')).toEqual({ ok: true, query: 'project = X' });
    expect(scopedQuery('project = X)', 'project', 'all', 'JQL')).toMatchObject({ ok: false });
  });

  it('refuses a query that would reach past its group: a stray parenthesis, an open one, an open quote', () => {
    expect(scopedQuery('project = X) OR (project = Y', 'project', ['AP'], 'JQL')).toEqual({
      ok: false,
      error: 'The JQL cannot be used as written: it closes a parenthesis it never opened.',
    });
    expect(scopedQuery('(a = 1', 'project', ['AP'], 'JQL')).toMatchObject({
      error: 'The JQL cannot be used as written: a parenthesis in it never closes.',
    });
    expect(scopedQuery('title ~ "open', 'space', ['ENG'], 'CQL')).toMatchObject({
      error: 'The CQL cannot be used as written: a quoted text in it never ends.',
    });
  });

  it('reads parentheses, quotes and ORDER BY inside quotes as text', () => {
    expect(readQuery("summary ~ \"a) OR (b\" AND text ~ 'it\\'s'")).toEqual({ orderAt: -1 });
    expect(readQuery('summary ~ "sort order by name"')).toEqual({ orderAt: -1 });
    expect(readQuery('(a = 1 ORDER BY b)')).toEqual({ orderAt: -1 });
    expect(readQuery('reorder by = 1')).toEqual({ orderAt: -1 });
    expect(readQuery('(a = 1)ORDER BY b')).toEqual({ orderAt: 7 });
  });
});

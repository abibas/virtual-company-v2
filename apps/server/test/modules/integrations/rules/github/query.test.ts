import { describe, expect, it } from 'vitest';
import { scopedSearch, scopesOf } from '../../../../../src/modules/integrations/rules/github/query.ts';

const REPOS = ['AiriaLLC/*', 'abibas/sandbox'];

describe('a GitHub search kept to the profile’s repositories', () => {
  it('adds the allowlist as qualifiers when the search names none, and the kind’s is:', () => {
    expect(scopedSearch({ query: 'author:@me' }, 'pr', REPOS)).toEqual({
      ok: true,
      q: 'author:@me user:AiriaLLC repo:abibas/sandbox is:pr',
    });
    expect(scopedSearch({ query: 'is:open label:bug' }, 'issue', REPOS)).toEqual({
      ok: true,
      q: 'is:open label:bug user:AiriaLLC repo:abibas/sandbox is:issue',
    });
    expect(scopedSearch({ query: 'web' }, 'repository', REPOS)).toEqual({
      ok: true,
      q: 'web user:AiriaLLC repo:abibas/sandbox',
    });
  });

  it('keeps the search’s own scope inside the allowlist and adds nothing then; all adds nothing at all', () => {
    expect(scopedSearch({ query: 'is:pr repo:airiallc/airia-platform' }, 'pr', REPOS)).toEqual({
      ok: true,
      q: 'is:pr repo:airiallc/airia-platform',
    });
    expect(scopedSearch({ query: 'fix', owner: 'AiriaLLC', repo: 'web' }, 'pr', REPOS)).toEqual({
      ok: true,
      q: 'fix repo:AiriaLLC/web is:pr',
    });
    expect(scopedSearch({ query: 'fix', owner: 'AiriaLLC' }, 'issue', REPOS)).toEqual({
      ok: true,
      q: 'fix user:AiriaLLC is:issue',
    });
    expect(scopedSearch({ query: 'type:pr org:any' }, 'pr', 'all')).toEqual({
      ok: true,
      q: 'type:pr org:any',
    });
    expect(scopedSearch({ query: 'x -repo:other/thing' }, 'pr', REPOS)).toMatchObject({
      q: 'x -repo:other/thing user:AiriaLLC repo:abibas/sandbox is:pr',
    });
  });

  it('refuses a scope outside the allowlist, naming it', () => {
    expect(scopedSearch({ query: 'repo:other/thing' }, 'pr', REPOS)).toEqual({
      ok: false,
      error:
        "other/thing is outside the GitHub repositories this agent's profile reaches (AiriaLLC/*, abibas/sandbox).",
    });
    const owner = scopedSearch({ query: 'user:abibas' }, 'pr', REPOS);
    expect(owner).toMatchObject({ ok: false });
    expect(owner.ok ? '' : owner.error).toContain('Every repository of abibas is outside');
    expect(owner.ok ? '' : owner.error).toContain('Name the repositories with repo: instead.');
    expect(scopedSearch({ query: 'x', owner: 'other', repo: 'r' }, 'issue', REPOS).ok).toBe(false);
    expect(scopedSearch({ query: 'repo:"bad"' }, 'pr', REPOS).ok).toBe(false);
  });

  it('reads the query’s scopes, quoted or not, never a negated one', () => {
    expect(scopesOf('repo:a/b ORG:"c" x -user:d user:e')).toEqual([
      { kind: 'repo', value: 'a/b' },
      { kind: 'owner', value: 'c' },
      { kind: 'owner', value: 'e' },
    ]);
  });
});

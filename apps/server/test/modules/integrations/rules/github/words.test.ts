import { SERVER_TOOL_LIMITS, ServerToolDef } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import {
  GITHUB_TOOL_INFO,
  githubLine,
  githubToolDef,
} from '../../../../../src/modules/integrations/rules/github/words.ts';
import { GitHubTool } from '../../../../../src/modules/integrations/schemas/github.ts';

const RIGHTS = { repos: ['AiriaLLC/*'], push: true, pullRequests: true, reviews: 'off' as const };

describe('the GitHub tools’ words', () => {
  it('define every tool for a spec: its words, its input schema, read-only unless it changes a pull request', () => {
    for (const tool of GitHubTool.options) {
      const def = githubToolDef(tool);
      expect(ServerToolDef.parse(def)).toEqual(def);
      expect(def).toMatchObject({ name: tool, ...GITHUB_TOOL_INFO[tool] });
      expect(JSON.stringify(def.inputSchema).length).toBeLessThan(SERVER_TOOL_LIMITS.schema);
      expect(def.inputSchema).not.toHaveProperty('$schema');
    }
    expect(githubToolDef('pull_request_read')).toMatchObject({ readOnly: true });
    expect(githubToolDef('pull_request_read').inputSchema).toMatchObject({
      required: ['method', 'owner', 'repo', 'pullNumber'],
    });
    expect(githubToolDef('create_pull_request').readOnly).toBe(false);
    expect(githubToolDef('pull_request_review_write').readOnly).toBe(false);
    expect(githubToolDef('add_comment_to_pending_review').inputSchema).toMatchObject({
      required: ['owner', 'repo', 'pullNumber', 'path', 'body', 'subjectType'],
    });
    expect(githubToolDef('list_branches')).toBe(githubToolDef('list_branches'));
  });

  it('say in the turn’s line where, as whom, which tools, and what git and gh get', () => {
    const tools = ['list_pull_requests', 'create_pull_request'] as const;
    const token = githubLine('ihor\nfake', RIGHTS, tools, { kind: 'token' });
    expect(token).toBe(
      "GitHub tools (from Most Wanted): as ihor fake, in AiriaLLC/*: read, and open and update pull requests. Your tools, by the names of GitHub's MCP server: list_pull_requests, create_pull_request; owner and repo name the repository; they never merge, close or delete. git and gh on this machine use this sign-in in this turn (GH_TOKEN; git@github.com remotes go over https): push your branches to those repositories, never to a default branch and never with force; the tools above are preferred for reading and for pull requests.",
    );
    const all = { repos: 'all' as const, push: false, pullRequests: false, reviews: 'off' as const };
    expect(githubLine(null, all, ['list_branches'], { kind: 'off' })).toBe(
      "GitHub tools (from Most Wanted): in every repository the account can see: read. Your tools, by the names of GitHub's MCP server: list_branches; owner and repo name the repository; they never merge, close or delete. Pushing is off for this profile: git and gh on this machine get no GitHub sign-in from Most Wanted.",
    );
    expect(githubLine(null, RIGHTS, tools, { kind: 'runner' })).toContain("this machine's runner is too old");
    const reviews = ['pull_request_review_write'] as const;
    expect(githubLine(null, { ...all, reviews: 'comment' }, reviews, { kind: 'off' })).toContain(
      ": read, and review pull requests with comments. Your tools, by the names of GitHub's MCP server: " +
        "pull_request_review_write; owner and repo name the repository; they never merge, close, delete, dismiss " +
        "others' reviews or approve your own pull requests.",
    );
    expect(githubLine(null, { ...RIGHTS, reviews: 'approve' }, reviews, { kind: 'off' })).toContain(
      ': read, open and update pull requests, and review them (comment, approve or request changes).',
    );
    expect(githubLine(null, RIGHTS, tools, { kind: 'failed', message: 'It was revoked.' })).toContain(
      'Pushing: the sign-in could not be opened for git now. It was revoked.',
    );
  });
});

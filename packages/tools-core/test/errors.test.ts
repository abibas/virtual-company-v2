import { describe, expect, it } from 'vitest';
import {
  ATLASSIAN_ERROR_CODES,
  AtlassianError,
  GITHUB_ERROR_CODES,
  GitHubError,
  isAtlassianError,
  isGitHubError,
  isSlackError,
  SLACK_ERROR_CODES,
  SlackError,
} from '../src/errors.ts';

describe('AtlassianError', () => {
  it('says each code in words, naming the product, with Atlassian’s own detail after', () => {
    for (const code of ATLASSIAN_ERROR_CODES) {
      const error = new AtlassianError(code, 'Jira');
      expect(error.message).toMatch(/^Jira /);
      expect(error).toMatchObject({ code, product: 'Jira', status: null, name: 'AtlassianError' });
    }
    const refused = new AtlassianError('bad_request', 'Confluence', { status: 400, detail: 'CQL is wrong.' });
    expect(refused.message).toBe('Confluence refused the request as written. CQL is wrong.');
    expect(refused.status).toBe(400);
    expect(new AtlassianError('needs_sign_in', 'Jira').message).toContain('sign in again');
  });

  it('is told apart from other errors', () => {
    expect(isAtlassianError(new AtlassianError('not_found', 'Jira'))).toBe(true);
    expect(isAtlassianError(new Error('x'))).toBe(false);
  });
});

describe('GitHubError', () => {
  it('says each code in words, with GitHub’s own detail after, and is told apart', () => {
    for (const code of GITHUB_ERROR_CODES) {
      const error = new GitHubError(code);
      expect(error.message).toMatch(/^GitHub /);
      expect(error).toMatchObject({ code, status: null, name: 'GitHubError' });
    }
    const refused = new GitHubError('bad_request', { status: 422, detail: 'A pull request already exists.' });
    expect(refused.message).toBe('GitHub refused the request as written. A pull request already exists.');
    expect(refused.status).toBe(422);
    expect(isGitHubError(refused)).toBe(true);
    expect(isGitHubError(new AtlassianError('not_found', 'Jira'))).toBe(false);
  });
});

describe('SlackError', () => {
  it('says each code in words, keeps Slack’s own error, and is told apart', () => {
    for (const code of SLACK_ERROR_CODES) {
      const error = new SlackError(code);
      expect(error.message).toMatch(/^(Slack|The bot) /);
      expect(error).toMatchObject({ code, status: null, slackError: null, name: 'SlackError' });
    }
    const refused = new SlackError('forbidden', {
      slackError: 'missing_scope',
      status: 200,
      detail: 'It lacks chat:write.',
    });
    expect(refused.message).toBe('Slack says the token may not do this. It lacks chat:write.');
    expect(refused).toMatchObject({ slackError: 'missing_scope', status: 200 });
    expect(new SlackError('not_in_channel').message).toContain('invite the bot');
    expect(isSlackError(refused)).toBe(true);
    expect(isSlackError(new GitHubError('not_found'))).toBe(false);
  });
});

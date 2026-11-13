import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import {
  ASK_PROMPT,
  allowedTools,
  CLAUDE_ACCOUNT_VARS,
  claudeEnv,
  credentialEnv,
  mcpConfig,
  sharedArgs,
  toolArgs,
  unsetFor,
} from '../src/args.ts';

const SESSION = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';
const GATEWAY = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'gw-key', 'X-Team': 'core' } };

describe('sharedArgs', () => {
  it('is empty for a new conversation on the defaults that asks', () => {
    expect(sharedArgs(fakeTerminalSpec('claude_code'))).toEqual([]);
  });

  it('adds the resume, the model, the effort and the skip flag, in that order', () => {
    const spec = fakeTerminalSpec('claude_code', {
      sessionId: SESSION,
      model: 'opus',
      effort: 'xhigh',
      permissionPolicy: 'bypass',
    });
    expect(sharedArgs(spec)).toEqual([
      '--resume',
      SESSION,
      '--model',
      'opus',
      '--effort',
      'xhigh',
      '--dangerously-skip-permissions',
    ]);
    expect(sharedArgs(fakeTerminalSpec('claude_code', { model: 'sonnet' }))).toEqual(['--model', 'sonnet']);
    expect(sharedArgs(fakeTerminalSpec('claude_code', { effort: 'low' }))).toEqual(['--effort', 'low']);
  });
});

describe('credentialEnv', () => {
  it('puts a login or a setup-token in CLAUDE_CODE_OAUTH_TOKEN and an API key in ANTHROPIC_API_KEY', () => {
    expect(credentialEnv(FAKE_CREDENTIALS.claude_oauth)).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'fake-claude-access-token',
    });
    expect(credentialEnv(FAKE_CREDENTIALS.claude_setup_token)).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token',
    });
    expect(credentialEnv(FAKE_CREDENTIALS.anthropic_api_key)).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-key',
    });
  });

  it('refuses an OpenAI credential as credential_mismatch', () => {
    for (const credential of [FAKE_CREDENTIALS.codex_oauth, FAKE_CREDENTIALS.openai_api_key]) {
      expect(() => credentialEnv(credential)).toThrow(
        `A ${credential.kind} subscription cannot power Claude Code.`,
      );
      try {
        credentialEnv(credential);
      } catch (error) {
        expect(isHarnessError(error, 'credential_mismatch')).toBe(true);
      }
    }
  });
});

describe('claudeEnv', () => {
  it('is the auto-updater off and the credential on the defaults', () => {
    expect(claudeEnv(fakeTerminalSpec('claude_code'))).toEqual({
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token',
    });
  });

  it('adds the config folder and the gateway with its headers one per line', () => {
    const spec = fakeTerminalSpec('claude_code', {
      credential: FAKE_CREDENTIALS.anthropic_api_key,
      configDir: '/home/agent/.claude-slop',
      gateway: GATEWAY,
    });
    expect(claudeEnv(spec)).toEqual({
      DISABLE_AUTOUPDATER: '1',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-key',
      CLAUDE_CONFIG_DIR: '/home/agent/.claude-slop',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Api-Key: gw-key\nX-Team: core',
    });
  });

  it('sends no custom headers for a gateway without any', () => {
    const spec = fakeTerminalSpec('claude_code', {
      gateway: { baseUrl: 'https://gw.example.com', headers: {} },
    });
    expect(claudeEnv(spec)).toEqual({
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token',
      ANTHROPIC_BASE_URL: 'https://gw.example.com',
    });
  });
});

const TOOLS = {
  dir: '/home/agent/.local/state/mwc-runner/turns/0a1b2c3d4e5f',
  command: '/usr/local/bin/node',
  args: ['/home/agent/.local/share/mwc-runner/runner.mjs', 'mcp'],
  env: {
    MWC_ASK_SOCKET: '/home/agent/.local/state/mwc-runner/turns/0a1b2c3d4e5f/ask.sock',
    MWC_ASK_TOKEN: 'tok',
  },
  names: ['ask_user_question'],
};

describe('the runner’s tools', () => {
  it('name the MCP config in the turn’s folder, allow the question tool and say when to use it', () => {
    expect(toolArgs(TOOLS)).toEqual([
      '--mcp-config',
      `${TOOLS.dir}/mcp.json`,
      '--allowedTools',
      'mcp__mwc__ask_user_question',
      '--append-system-prompt',
      ASK_PROMPT,
    ]);
    expect(ASK_PROMPT).toBe(
      'When the person must choose between options, ask them with the ask_user_question tool, then end your ' +
        'turn: their answer comes as their next message.',
    );
    expect(ASK_PROMPT).not.toContain('\n');
  });

  it('allow the agents’ tools as one comma-joined argument after the question tool, passing over odd names', () => {
    const work = {
      ...TOOLS,
      env: { ...TOOLS.env, MWC_TOOLS: 'task_read,task_hand_on,task_attach,task_blocked' },
      names: ['ask_user_question', 'task_read', 'task_hand_on', 'task_attach', 'task_blocked'],
    };
    expect(toolArgs(work, false)).toEqual([
      '--mcp-config',
      `${TOOLS.dir}/mcp.json`,
      '--allowedTools',
      'mcp__mwc__ask_user_question,mcp__mwc__task_read,mcp__mwc__task_hand_on,mcp__mwc__task_attach,' +
        'mcp__mwc__task_blocked',
    ]);
    expect(allowedTools({ ...TOOLS, names: ['team_board', 'Bash rm', 'a,b', 'task_show'] })).toBe(
      'mcp__mwc__ask_user_question,mcp__mwc__team_board,mcp__mwc__task_show',
    );
    expect(allowedTools({ ...TOOLS, names: [] })).toBe('mcp__mwc__ask_user_question');
  });

  it('allows the server’s own tools by their camelCase names, still one plain word each (S7.1c)', () => {
    const names = ['searchJiraIssuesUsingJql', 'getJiraIssue', 'get-thing', 'mcp__x y', '9lives'];
    expect(allowedTools({ ...TOOLS, names })).toBe(
      'mcp__mwc__ask_user_question,mcp__mwc__searchJiraIssuesUsingJql,mcp__mwc__getJiraIssue',
    );
  });

  it('start the runner’s MCP server with its socket and token in the config, never on a command line', () => {
    expect(JSON.parse(mcpConfig(TOOLS))).toEqual({
      mcpServers: { mwc: { type: 'stdio', command: TOOLS.command, args: TOOLS.args, env: TOOLS.env } },
    });
    expect(toolArgs(TOOLS).join(' ')).not.toContain('tok');
  });
});

describe('unsetFor', () => {
  it('removes every account variable the turn does not set', () => {
    expect(unsetFor({})).toEqual([...CLAUDE_ACCOUNT_VARS]);
    expect(unsetFor({ CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: '/c' })).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_CUSTOM_HEADERS',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]);
  });
});

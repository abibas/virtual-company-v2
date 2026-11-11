import { isHarnessError, type ProcessSpec } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import { ASK_PROMPT, CLAUDE_ACCOUNT_VARS } from '../src/args.ts';
import { ClaudeCodeDriver } from '../src/driver.ts';
import { ClaudeLineParser } from '../src/parser.ts';

const SESSION = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';
const TURN = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--input-format',
  'stream-json',
  '--replay-user-messages',
];

/** The user message a stdin line holds. */
const messageOf = (stdin: string | null) => JSON.parse(stdin ?? 'null');

/** The private settings file every turn and terminal gets: Anthropic's own address and no headers without a gateway. */
const SETTINGS_DIR = {
  path: null,
  files: [
    {
      name: expect.stringMatching(/^settings-[0-9a-f]{12}\.json$/),
      contents: JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_CUSTOM_HEADERS: '' },
      }),
      mode: 0o600,
      option: '--settings',
    },
  ],
};

/** The settings a process's private file holds. */
const settingsOf = (process: ProcessSpec) => JSON.parse(process.privateDir?.files[0]?.contents ?? 'null');

describe('ClaudeCodeDriver.turn', () => {
  const driver = new ClaudeCodeDriver();

  it('starts a new conversation in print mode with the prompt as the first user message on stdin, kept open', () => {
    const process = driver.turn(fakeTurnSpec('claude_code'));
    expect(process).toEqual({
      command: 'claude',
      args: TURN,
      env: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token' },
      unsetEnv: CLAUDE_ACCOUNT_VARS.filter((name) => name !== 'CLAUDE_CODE_OAUTH_TOKEN'),
      stdin: expect.stringMatching(/\n$/),
      stdinOpen: true,
      privateDir: SETTINGS_DIR,
      notices: [],
    });
    expect(messageOf(process.stdin)).toEqual({
      type: 'user',
      uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: 'What is 2 + 2?' }] },
    });
  });

  it('gives a message for the running turn as one more user message line, with its id', () => {
    const line = driver.inputLine('Use staging', '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e');
    expect(line.endsWith('\n')).toBe(true);
    expect(messageOf(line)).toMatchObject({
      type: 'user',
      uuid: '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e',
      message: { content: [{ type: 'text', text: 'Use staging' }] },
    });
  });

  it('resumes the session with the model, the effort and no permission prompts', () => {
    const spec = fakeTurnSpec('claude_code', {
      sessionId: SESSION,
      model: 'claude-opus-5-5',
      effort: 'max',
      permissionPolicy: 'bypass',
      prompt: '-p --help and double it',
    });
    const process = driver.turn(spec);
    expect(process.args).toEqual([
      ...TURN,
      '--resume',
      SESSION,
      '--model',
      'claude-opus-5-5',
      '--effort',
      'max',
      '--dangerously-skip-permissions',
    ]);
    expect(messageOf(process.stdin).message.content[0].text).toBe('-p --help and double it');
    expect(process.args).not.toContain(spec.prompt);
  });

  it("forks the resumed session for a branch's first turn, up to a message when it says one", () => {
    const fork = fakeTurnSpec('claude_code', { sessionId: SESSION, forkSession: true });
    expect(driver.turn(fork).args).toEqual([...TURN, '--resume', SESSION, '--fork-session']);
    expect(driver.turn({ ...fork, resumeAt: 'c0a80101-message' }).args).toEqual([
      ...TURN,
      '--resume',
      SESSION,
      '--fork-session',
      '--resume-session-at',
      'c0a80101-message',
    ]);
    // A new conversation has nothing to fork; the terminal never forks.
    expect(driver.turn(fakeTurnSpec('claude_code', { forkSession: true })).args).toEqual(TURN);
    expect(driver.terminal(fork).args).toEqual(['--resume', SESSION]);
  });

  it('asks (no skip flag) under the ask policy, so -p refuses what needs approval', () => {
    expect(driver.turn(fakeTurnSpec('claude_code', { permissionPolicy: 'ask' })).args).toEqual(TURN);
  });

  it('gives each credential kind its variable, with the config folder and the gateway', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'gw' } };
    for (const [credential, variable] of [
      [FAKE_CREDENTIALS.claude_oauth, 'CLAUDE_CODE_OAUTH_TOKEN'],
      [FAKE_CREDENTIALS.claude_setup_token, 'CLAUDE_CODE_OAUTH_TOKEN'],
      [FAKE_CREDENTIALS.anthropic_api_key, 'ANTHROPIC_API_KEY'],
    ] as const) {
      const process = driver.turn(fakeTurnSpec('claude_code', { credential, configDir: '/cfg', gateway }));
      expect(Object.keys(process.env).sort()).toEqual(
        [
          'DISABLE_AUTOUPDATER',
          variable,
          'CLAUDE_CONFIG_DIR',
          'ANTHROPIC_BASE_URL',
          'ANTHROPIC_CUSTOM_HEADERS',
        ].sort(),
      );
      expect(process.unsetEnv).not.toContain(variable);
      expect(process.unsetEnv).not.toContain('CLAUDE_CONFIG_DIR');
      expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe('X-Api-Key: gw');
      expect(settingsOf(process)).toEqual({
        env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300', ANTHROPIC_CUSTOM_HEADERS: 'X-Api-Key: gw' },
      });
      expect(process.privateDir).not.toHaveProperty('env');
    }
  });

  it('lets the profile’s gateway decide: its settings file, never the headers on the command line', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'x-airia-key': 'secret-gw' } };
    const process = driver.turn(fakeTurnSpec('claude_code', { gateway }));
    expect(process.privateDir?.files).toEqual([
      expect.objectContaining({ option: '--settings', mode: 0o600 }),
    ]);
    expect(settingsOf(process).env.ANTHROPIC_CUSTOM_HEADERS).toBe('x-airia-key: secret-gw');
    expect(process.args.join(' ')).not.toContain('secret-gw');
    expect(process.args).not.toContain('--settings');
    const direct = driver.turn(fakeTurnSpec('claude_code'));
    expect(settingsOf(direct)).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_CUSTOM_HEADERS: '' },
    });
    expect(direct.unsetEnv).toEqual(
      expect.arrayContaining(['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']),
    );
  });

  it('gives a turn with the runner’s tools its MCP config to write, the tool allowed and the line, after the rest', () => {
    const tools = {
      dir: '/state/turns/0a1b',
      command: '/usr/bin/node',
      args: ['/opt/runner.mjs', 'mcp'],
      env: { MWC_ASK_SOCKET: '/state/turns/0a1b/ask.sock', MWC_ASK_TOKEN: 'tok' },
      names: ['ask_user_question'],
    };
    const process = driver.turn(fakeTurnSpec('claude_code', { permissionPolicy: 'bypass' }), tools);
    expect(process.args).toEqual([
      ...TURN,
      '--dangerously-skip-permissions',
      '--mcp-config',
      '/state/turns/0a1b/mcp.json',
      '--allowedTools',
      'mcp__mwc__ask_user_question',
      '--append-system-prompt',
      ASK_PROMPT,
    ]);
    expect(process.turnFiles).toEqual([
      {
        name: 'mcp.json',
        contents: JSON.stringify({
          mcpServers: { mwc: { type: 'stdio', command: '/usr/bin/node', args: tools.args, env: tools.env } },
        }),
        mode: 0o600,
      },
    ]);
    expect(process.env).not.toHaveProperty('MWC_ASK_TOKEN');
    expect(driver.turn(fakeTurnSpec('claude_code')).turnFiles).toBeUndefined();
  });

  it('gives standing instructions in a private file, renders the prompt fresh, and puts the asking line in it', () => {
    const tools = {
      dir: '/state/turns/0a1b',
      command: '/usr/bin/node',
      args: ['/r.mjs', 'mcp'],
      env: { MWC_TOOLS: 'task_read,task_pass,task_send_back' },
      names: ['ask_user_question', 'task_read', 'task_pass', 'task_send_back'],
    };
    const spec = fakeTurnSpec('claude_code', {
      sessionId: SESSION,
      instructions: '## Your place\n\n- You are QA.',
    });
    const plain = driver.turn(spec);
    expect(plain.args).toEqual([...TURN, '--resume', SESSION, '--system-prompt-snapshot', 'off']);
    expect(plain.privateDir?.files[1]).toEqual({
      name: expect.stringMatching(/^instructions-[0-9a-f]{12}\.md$/),
      contents: '## Your place\n\n- You are QA.',
      mode: 0o600,
      option: '--append-system-prompt-file',
    });
    const asked = driver.turn(spec, tools);
    expect(asked.args).not.toContain('--append-system-prompt');
    expect(asked.args.slice(-4)).toEqual([
      '--mcp-config',
      '/state/turns/0a1b/mcp.json',
      '--allowedTools',
      'mcp__mwc__ask_user_question,mcp__mwc__task_read,mcp__mwc__task_pass,mcp__mwc__task_send_back',
    ]);
    expect(asked.privateDir?.files[1]?.contents).toBe(`## Your place\n\n- You are QA.\n\n${ASK_PROMPT}`);
    expect(asked.privateDir?.files[1]?.name).not.toBe(plain.privateDir?.files[1]?.name);
  });

  it('uses the program the runner found', () => {
    const found = new ClaudeCodeDriver({ command: '/home/agent/.local/bin/claude' });
    expect(found.turn(fakeTurnSpec('claude_code')).command).toBe('/home/agent/.local/bin/claude');
    expect(found.command).toBe('/home/agent/.local/bin/claude');
  });

  it('refuses an OpenAI credential, a Codex turn, an empty prompt and an option-like session id', () => {
    const cases = [
      [fakeTurnSpec('claude_code', { credential: FAKE_CREDENTIALS.codex_oauth }), 'credential_mismatch'],
      [fakeTurnSpec('claude_code', { credential: FAKE_CREDENTIALS.openai_api_key }), 'credential_mismatch'],
      [fakeTurnSpec('codex'), 'invalid_spec'],
      [fakeTurnSpec('claude_code', { prompt: '  ' }), 'invalid_spec'],
      [fakeTurnSpec('claude_code', { sessionId: '--fork-session' }), 'invalid_spec'],
    ] as const;
    for (const [spec, code] of cases) {
      try {
        driver.turn(spec);
        expect.unreachable();
      } catch (error) {
        expect(isHarnessError(error, code)).toBe(true);
      }
    }
  });
});

describe('ClaudeCodeDriver.terminal', () => {
  const driver = new ClaudeCodeDriver();

  it('opens the TUI on a new conversation, or resumes one, with no prompt', () => {
    expect(driver.terminal(fakeTerminalSpec('claude_code'))).toEqual({
      command: 'claude',
      args: [],
      env: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token' },
      unsetEnv: CLAUDE_ACCOUNT_VARS.filter((name) => name !== 'CLAUDE_CODE_OAUTH_TOKEN'),
      stdin: null,
      privateDir: SETTINGS_DIR,
      notices: [],
    });
    const spec = fakeTerminalSpec('claude_code', {
      sessionId: SESSION,
      model: 'opus',
      permissionPolicy: 'bypass',
    });
    expect(driver.terminal(spec).args).toEqual([
      '--resume',
      SESSION,
      '--model',
      'opus',
      '--dangerously-skip-permissions',
    ]);
  });

  it('gives the TUI the gateway’s settings file and variables too', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'x-memory-agent': 'slop' } };
    const process = driver.terminal(fakeTerminalSpec('claude_code', { gateway }));
    expect(settingsOf(process)).toEqual({
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300', ANTHROPIC_CUSTOM_HEADERS: 'x-memory-agent: slop' },
    });
    expect(process.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300',
      ANTHROPIC_CUSTOM_HEADERS: 'x-memory-agent: slop',
    });
    expect(process.args).toEqual([]);
  });

  it('gives the TUI the standing instructions too', () => {
    const process = driver.terminal(fakeTerminalSpec('claude_code', { instructions: 'Briefing' }));
    expect(process.args).toEqual(['--system-prompt-snapshot', 'off']);
    expect(process.privateDir?.files.map((file) => [file.contents, file.option])).toEqual([
      [expect.any(String), '--settings'],
      ['Briefing', '--append-system-prompt-file'],
    ]);
  });

  it('refuses a credential of the other family', () => {
    expect(() =>
      driver.terminal(fakeTerminalSpec('claude_code', { credential: FAKE_CREDENTIALS.codex_oauth })),
    ).toThrow('A codex_oauth subscription cannot power Claude Code.');
  });
});

describe('ClaudeCodeDriver', () => {
  it('is the claude_code harness, prints its version with --version and gives a new parser each time', () => {
    const driver = new ClaudeCodeDriver();
    expect(driver.harness).toBe('claude_code');
    expect(driver.versionArgs).toEqual(['--version']);
    const parser = driver.parser();
    expect(parser).toBeInstanceOf(ClaudeLineParser);
    expect(driver.parser()).not.toBe(parser);
  });
});

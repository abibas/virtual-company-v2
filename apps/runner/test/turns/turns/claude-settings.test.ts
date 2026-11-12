import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_COMMAND, fakeHarnessHost, startTurn as start, turnsWorld } from '../../fixtures/turns.ts';

describe("a Claude Code turn's settings file", () => {
  /** A host on the real Claude Code driver, started as the fake program. */
  const claudeHost = () =>
    fakeHarnessHost({ drivers: { claude_code: new ClaudeCodeDriver({ command: FAKE_COMMAND }) } });

  it('holds the profile’s gateway 0600 while the process runs, named by --settings, and goes after it', async () => {
    const { host, cwd, stateDir } = claudeHost();
    const w = turnsWorld({ host });
    let during: { settings: unknown; mode: number } | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      const args = w.spawn.calls[0]?.args as string[];
      const path = args[args.indexOf('--settings') + 1] as string;
      during = { settings: JSON.parse(readFileSync(path, 'utf8')), mode: statSync(path).mode & 0o777 };
      child.finish('', 0);
    });
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'x-airia-key': 'gw-secret' } };
    start(w, fakeTurnSpec('claude_code', { cwd, gateway }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const [call] = w.spawn.calls;
    const path = call?.args.at(-1) as string;
    expect(call?.args.at(-2)).toBe('--settings');
    expect(path.startsWith(join(stateDir, 'claude_code'))).toBe(true);
    expect(path).toMatch(/settings-[0-9a-f]{12}\.json$/);
    expect(during).toEqual({
      settings: {
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300',
          ANTHROPIC_CUSTOM_HEADERS: 'x-airia-key: gw-secret',
        },
      },
      mode: 0o600,
    });
    expect(existsSync(path)).toBe(false);
    expect(call?.args.join(' ')).not.toContain('gw-secret');
    expect(call?.options.env).toMatchObject({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300' });
    expect(call?.options.env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(JSON.stringify(w.logs.entries)).not.toContain('gw-secret');
  });

  it('without a gateway, points the turn at Anthropic itself so the machine’s own gateway is not used', async () => {
    const { host, cwd } = claudeHost();
    const w = turnsWorld({ host });
    let settings: unknown;
    w.spawn.when(FAKE_COMMAND, (child) => {
      settings = JSON.parse(readFileSync(w.spawn.calls[0]?.args.at(-1) as string, 'utf8'));
      child.finish('', 0);
    });
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(settings).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_CUSTOM_HEADERS: '' },
    });
    expect(w.spawn.calls[0]?.options.env).not.toHaveProperty('ANTHROPIC_BASE_URL');
    expect(host.dirs.inUse).toEqual([]);
  });
});

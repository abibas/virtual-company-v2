import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  doubleQuoted,
  type ResumeTarget,
  resumeCommands,
  resumeLine,
  shellQuote,
  shellWord,
} from '../src/resume.ts';

const SESSION = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';
const base: ResumeTarget = {
  harness: 'claude_code',
  sessionId: SESSION,
  folder: '/Users/ihor/agents/slop-box',
  configDir: null,
  machine: { name: 'This Mac', kind: 'laptop', provider: 'none', hostname: 'ihors-mac' },
};

describe('Open in Claude Code', () => {
  it('resumes in the folder on a Mac, with the config folder when the agent has one', () => {
    expect(resumeCommands(base)).toEqual([
      {
        where: 'In a Terminal on This Mac',
        command: `cd '/Users/ihor/agents/slop-box' && claude --resume ${SESSION}`,
      },
    ]);
    expect(resumeLine({ ...base, configDir: '/Users/ihor/.claude-slop' })).toBe(
      `cd '/Users/ihor/agents/slop-box' && CLAUDE_CONFIG_DIR='/Users/ihor/.claude-slop' claude --resume ${SESSION}`,
    );
    expect(resumeCommands({ ...base, machine: undefined })[0]?.where).toBe('In a Terminal on the machine');
  });

  it('goes through the devbox’s own CLI and through docker exec, quoted once more for the first shell', () => {
    const line = `cd '/home/ihor/airia-dev' && claude --resume ${SESSION}`;
    const devbox = resumeCommands({
      ...base,
      folder: '/home/ihor/airia-dev',
      machine: { name: 'Devbox', kind: 'vm', provider: 'airia_devbox', hostname: 'dev-ihorherasko' },
    });
    expect(devbox.map((c) => c.command)).toEqual([`airia devbox ssh -- -t "${line}"`, line]);
    const container = resumeCommands({
      ...base,
      folder: '/work/agent',
      machine: { name: 'Box', kind: 'container', provider: 'none', hostname: '3f2a9c1b7d4e' },
    });
    expect(container[0]?.command).toBe(
      `docker exec -it 3f2a9c1b7d4e sh -lc "cd '/work/agent' && claude --resume ${SESSION}"`,
    );
    expect(container[1]?.command).toBe(`cd '/work/agent' && claude --resume ${SESSION}`);
  });

  it('resumes a Codex thread the same way, its home in CODEX_HOME', () => {
    expect(resumeLine({ ...base, harness: 'codex', sessionId: 'thr_1', configDir: '/cfg' })).toBe(
      "cd '/Users/ihor/agents/slop-box' && CODEX_HOME='/cfg' codex resume thr_1",
    );
  });

  it('quotes every path and odd word so each shell reads it back as it was', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellWord(SESSION)).toBe(SESSION);
    expect(shellWord('a b')).toBe(`'a b'`);
    expect(doubleQuoted('a "b" $c `d` \\e')).toBe('"a \\"b\\" \\$c \\`d\\` \\\\e"');
    const folder = `/tmp/it's a $HOME "dir" \`x\` \\ end`;
    const odd = 'id with $space';
    const line = resumeLine({ ...base, folder, sessionId: odd });
    const script = `printf '%s\\0' ${shellQuote(folder)} ${shellWord(odd)}; printf '%s' ${doubleQuoted(line)}`;
    const [readFolder, readId, readLine] = execFileSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
    }).split('\0');
    expect([readFolder, readId, readLine]).toEqual([folder, odd, line]);
  });
});

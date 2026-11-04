import { describe, expect, it } from 'vitest';
import { MAX_PIPED_BYTES, readKey } from '../../src/account/secret.ts';
import { KEY, piped, terminal, untouchedStdin } from '../fixtures/account.ts';

const quiet = () => {
  const said: string[] = [];
  return { stderr: (s: string) => said.push(s), said };
};

describe('readKey from the environment', () => {
  it('takes MWC_API_KEY, trimmed, and never reads standard input', async () => {
    expect(await readKey({ MWC_API_KEY: ` ${KEY}\n` }, untouchedStdin(), quiet().stderr)).toBe(KEY);
  });

  it('reads standard input when MWC_API_KEY is empty or blank', async () => {
    expect(await readKey({ MWC_API_KEY: '  ' }, piped(KEY), quiet().stderr)).toBe(KEY);
  });
});

describe('readKey from a pipe', () => {
  it('reads everything piped in, in string or byte chunks, trimmed, without prompting', async () => {
    const { stderr, said } = quiet();
    expect(await readKey({}, piped(`${KEY.slice(0, 10)}`, Buffer.from(`${KEY.slice(10)}\n`)), stderr)).toBe(
      KEY,
    );
    expect(said).toEqual([]);
  });

  it('reads nothing, or more than a key could be, as no key', async () => {
    expect(await readKey({}, piped(), quiet().stderr)).toBeUndefined();
    expect(await readKey({}, piped(' \n'), quiet().stderr)).toBeUndefined();
    expect(await readKey({}, piped('x'.repeat(MAX_PIPED_BYTES), 'y'), quiet().stderr)).toBeUndefined();
  });
});

describe('readKey at a terminal', () => {
  it('prompts on stderr and reads a line with echo off, then restores the terminal', async () => {
    const { stdin, rawModes } = terminal();
    const { stderr, said } = quiet();
    stdin.write(`${KEY}\r`);
    expect(await readKey({}, stdin, stderr)).toBe(KEY);
    expect(said).toEqual(['Paste your personal API key (mwc_pk_..., input hidden): ', '\n']);
    expect(rawModes).toEqual([true, false]);
    expect(stdin.isPaused()).toBe(true);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('erases with Backspace, ignores other control characters and takes Ctrl-D or a newline as the end', async () => {
    const typo = terminal();
    typo.stdin.write(`x${KEY.slice(0, 5)}Q\u007f\u001b\t`);
    typo.stdin.write(Buffer.from(`${KEY.slice(5)}\n`));
    const pending = readKey({}, typo.stdin, quiet().stderr);
    expect(await pending).toBe(`x${KEY}`);
    const erased = terminal();
    erased.stdin.write(`zz\b\b${KEY}\u0004trailing`);
    expect(await readKey({}, erased.stdin, quiet().stderr)).toBe(KEY);
  });

  it('cancels on Ctrl-C, and reads an empty line as no key', async () => {
    const cancelled = terminal();
    cancelled.stdin.write(`${KEY.slice(0, 8)}\u0003${KEY.slice(8)}\r`);
    expect(await readKey({}, cancelled.stdin, quiet().stderr)).toBeUndefined();
    expect(cancelled.rawModes).toEqual([true, false]);
    const empty = terminal();
    empty.stdin.write('   \r');
    expect(await readKey({}, empty.stdin, quiet().stderr)).toBeUndefined();
  });

  it('waits for what is typed after the prompt', async () => {
    const { stdin } = terminal();
    const pending = readKey({}, stdin, quiet().stderr);
    await new Promise((resolve) => setImmediate(resolve));
    stdin.write(KEY.slice(0, 16));
    stdin.write(`${KEY.slice(16)}\r`);
    expect(await pending).toBe(KEY);
  });
});

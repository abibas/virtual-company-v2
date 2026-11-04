/**
 * Reading an API key without it ever being a command-line argument (which would stay in the shell history):
 * `MWC_API_KEY`, else standard input, piped (`pbpaste | mwc login ...`) or typed at a prompt with echo off.
 */

/** The standard input the commands read: `process.stdin`, or a stream in tests. */
export interface SecretInput extends AsyncIterable<string | Buffer> {
  readonly isTTY?: boolean;
  setRawMode?(on: boolean): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
  on(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  removeListener(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** More than this on standard input is not a key. */
export const MAX_PIPED_BYTES = 64 * 1024;

const ENTER = new Set(['\r', '\n', '\u0004']);
const ERASE = new Set(['\u007f', '\b']);
const CANCEL = '\u0003';

/** Everything piped in, trimmed; undefined for nothing or for more than MAX_PIPED_BYTES. */
async function readPiped(stdin: SecretInput): Promise<string | undefined> {
  let text = '';
  for await (const chunk of stdin) {
    text += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text.length > MAX_PIPED_BYTES) return undefined;
  }
  return text.trim() || undefined;
}

/**
 * Prompts on stderr and reads one line from a terminal in raw mode, so nothing typed or pasted is echoed: Enter (or
 * Ctrl-D) ends it, Backspace erases, Ctrl-C cancels (undefined), other control characters are ignored.
 */
function readHidden(
  stdin: SecretInput,
  stderr: (s: string) => void,
  prompt: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let typed = '';
    const finish = (value: string | undefined) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      stderr('\n');
      resolve(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const char of typeof chunk === 'string' ? chunk : chunk.toString('utf8')) {
        if (char === CANCEL) return finish(undefined);
        if (ENTER.has(char)) return finish(typed.trim() || undefined);
        if (ERASE.has(char)) typed = typed.slice(0, -1);
        else if (char >= ' ') typed += char;
      }
    };
    stderr(prompt);
    stdin.setEncoding?.('utf8');
    stdin.setRawMode?.(true);
    stdin.on('data', onData);
    stdin.resume();
  });
}

/** The key from `MWC_API_KEY`, else from standard input (a hidden prompt on a terminal); undefined for none. */
export async function readKey(
  env: Readonly<Record<string, string | undefined>>,
  stdin: SecretInput,
  stderr: (s: string) => void,
): Promise<string | undefined> {
  if (env.MWC_API_KEY?.trim()) return env.MWC_API_KEY.trim();
  if (!stdin.isTTY) return readPiped(stdin);
  return readHidden(stdin, stderr, 'Paste your personal API key (mwc_pk_..., input hidden): ');
}

/**
 * `mwc dev outbox [--last N] [--full]`: the emails the development server wrote to its outbox (MWC_EMAIL=outbox, the
 * development default; docs/notifications.md) instead of sending them: the newest `N` (10 by default) as one line each
 * (date, to, subject), or with `--full` each email as written. It reads `.data/outbox/` at the repository root and
 * nothing else; no email is ever sent from here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedArgs } from './args.ts';
import { type MainIo, REPO_ROOT } from './io.ts';

export const OUTBOX_USAGE = 'usage: mwc dev outbox [--last N] [--full]';

/** The development outbox's folder. */
export const DEV_OUTBOX = join(REPO_ROOT, '.data', 'outbox');

/** A header as it reads, `=?UTF-8?B?…?=` decoded. */
export function decodeHeader(value: string): string {
  return value.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/gi, (_, base64: string) =>
    Buffer.from(base64, 'base64').toString('utf8'),
  );
}

/** One email's headers, by lower-cased name. */
export function headersOf(text: string): Map<string, string> {
  const head = text.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const headers = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0)
      headers.set(line.slice(0, colon).toLowerCase(), decodeHeader(line.slice(colon + 1).trim()));
  }
  return headers;
}

/** The `.eml` files of the outbox, newest first; none when it does not exist yet. */
function emails(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.eml'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function outboxCommand(args: ParsedArgs, io: MainIo, dir: string = DEV_OUTBOX): number {
  const last = args.options.last === undefined ? 10 : Number(args.options.last);
  const extra = args.positionals.slice(1);
  if (!Number.isInteger(last) || last < 1 || args.flags.has('last') || extra.length > 0) {
    io.stderr(`mwc dev outbox: ${OUTBOX_USAGE}\n`);
    return 2;
  }
  const files = emails(dir).slice(0, last);
  if (files.length === 0) {
    io.stdout(
      `The outbox is empty (${dir}). The development server writes emails there (MWC_EMAIL=outbox).\n`,
    );
    return 0;
  }
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (args.flags.has('full')) {
      io.stdout(`── ${file}\n${decodeHeader(text.replace(/\r\n/g, '\n'))}\n`);
      continue;
    }
    const headers = headersOf(text);
    io.stdout(
      `${headers.get('date') ?? '?'}  ${headers.get('to') ?? '?'}  ${headers.get('subject') ?? ''}\n`,
    );
  }
  return 0;
}

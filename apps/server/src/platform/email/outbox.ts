import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '@mwc/shared/ids';
import type { Logger } from 'pino';
import { type EmailMessage, type EmailSender, messageText } from './port.ts';

/**
 * The development outbox (MWC_EMAIL=outbox, the development default): every email is written as an `.eml` file to
 * `<data>/outbox/` (`.data/` is git-ignored) and logged in one line; nothing leaves the computer. `mwc dev outbox` lists
 * and prints them; any mail app opens the files.
 */

/** The outbox's folder name in the data folder. */
export const OUTBOX_DIR = 'outbox';

export interface OutboxOptions {
  /** The data folder (`.data/` in development); the files go to its `outbox/`. */
  readonly dataDir: string;
  /** The From of every email (MWC_EMAIL_FROM). */
  readonly from: string;
  readonly logger: Logger;
  readonly clock: () => Date;
}

/** A file name that sorts by time: `2026-11-10T09-30-00.000Z-<id>.eml`. */
export const outboxFileName = (at: Date) => `${at.toISOString().replaceAll(':', '-')}-${newId()}.eml`;

export function fileOutbox(options: OutboxOptions): EmailSender {
  const dir = join(options.dataDir, OUTBOX_DIR);
  return {
    kind: 'outbox',
    async send(message: EmailMessage): Promise<void> {
      const at = options.clock();
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, outboxFileName(at));
      await writeFile(file, messageText(message, options.from, at), { mode: 0o600 });
      options.logger.info(
        { to: message.to, subject: message.subject, file },
        'email written to the dev outbox (mwc dev outbox)',
      );
    },
  };
}

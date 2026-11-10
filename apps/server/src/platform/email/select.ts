import type { Config } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { DEV_DATA_DIR } from '../secrets/master-key.ts';
import { fileOutbox } from './outbox.ts';
import type { EmailSender } from './port.ts';

/**
 * The email sender MWC_EMAIL names: the development outbox (`outbox`), or none (`off`, the default outside
 * development: notification emails are skipped). `smtp` is refused by the configuration until its sender is built
 * (docs/notifications.md, "Email").
 */
export function emailFromConfig(
  config: Pick<Config, 'MWC_EMAIL' | 'MWC_EMAIL_FROM'>,
  logger: Logger,
  options: { readonly dataDir?: string; readonly clock?: () => Date } = {},
): EmailSender | undefined {
  if (config.MWC_EMAIL !== 'outbox') return undefined;
  return fileOutbox({
    dataDir: options.dataDir ?? DEV_DATA_DIR,
    from: config.MWC_EMAIL_FROM,
    logger,
    clock: options.clock ?? (() => new Date()),
  });
}

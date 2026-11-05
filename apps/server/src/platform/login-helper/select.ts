import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Config } from '@mwc/shared/config';
import type { Logger } from 'pino';
import { dockerLoginHelper, readLoginDockerfile } from './docker.ts';
import { localLoginHelper } from './local.ts';
import type { LoginHelper } from './port.ts';

/** The PATH a local login gets when the server has none. */
const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * The sign-in helper MWC_LOGIN_HELPER names: Docker (development), a local temporary folder (a Linux server with the
 * CLIs), or none (sign-in with a subscription answers 503). Making one starts nothing: the Docker image is built on
 * the first sign-in.
 */
export function loginHelperFromConfig(
  config: Pick<Config, 'MWC_LOGIN_HELPER'>,
  logger: Logger,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LoginHelper | undefined {
  switch (config.MWC_LOGIN_HELPER) {
    case 'docker':
      return dockerLoginHelper({ spawn, dockerfile: readLoginDockerfile, logger });
    case 'local':
      return localLoginHelper({
        spawn,
        fs: { mkdtemp, readFile, rm },
        tmpDir: tmpdir(),
        path: env.PATH ?? DEFAULT_PATH,
      });
    case 'none':
      return undefined;
  }
}

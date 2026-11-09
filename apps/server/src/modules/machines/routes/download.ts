import {
  RUNNER_BUNDLE_PATH,
  RUNNER_INSTALL_SCRIPT_PATH,
  RUNNER_PTY_PATH,
  RUNNER_SHA256_HEADER,
  RunnerPtyTarget,
} from '@mwc/shared/runner-protocol';
import type { ServerDeps } from '../../../platform/env.ts';
import { errorJson } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { DEFAULT_RUNNER_BUNDLE, ptyArchivePath, readRunnerBundle } from '../service/runner/download.ts';
import { INSTALL_SCRIPT } from '../service/runner/install-script.ts';

/**
 * Installing a runner (S4.5, docs/machines.md "Installing a runner"): `GET /api/runner/install.sh`, the installer a
 * machine pipes into `sh`, and `GET /api/runner/runner.mjs`, the runner it downloads, with its SHA-256 in a header
 * (404 `runner_bundle_missing` until `pnpm --filter @mwc/runner build` made it), and `GET /api/runner/pty/<target>.tgz`,
 * the terminal's PTY for a system, also with its SHA-256 (404 `runner_pty_missing` for a system none is built for, or
 * until the build). All public: the enrollment token the script is given is the secret. Not in the OpenAPI document:
 * none is JSON.
 */
export function runnerDownloadRoutes(deps: ServerDeps) {
  const bundlePath = deps.runnerBundle ?? DEFAULT_RUNNER_BUNDLE;
  return newRouter()
    .get(RUNNER_INSTALL_SCRIPT_PATH, (c) =>
      c.body(INSTALL_SCRIPT, 200, {
        'content-type': 'text/x-shellscript; charset=utf-8',
        'cache-control': 'no-store',
      }),
    )
    .get(RUNNER_BUNDLE_PATH, async (c) => {
      const bundle = await readRunnerBundle(bundlePath);
      if (!bundle.ok) {
        return errorJson(
          c,
          404,
          'runner_bundle_missing',
          'The runner is not built on this server (pnpm --filter @mwc/runner build)',
        );
      }
      return c.body(bundle.body, 200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
        [RUNNER_SHA256_HEADER]: bundle.sha256,
      });
    })
    .get(`${RUNNER_PTY_PATH}/:file`, async (c) => {
      const file = c.req.param('file');
      const target = RunnerPtyTarget.safeParse(file.replace(/\.tgz$/, ''));
      const archive =
        target.success && file.endsWith('.tgz')
          ? await readRunnerBundle(ptyArchivePath(bundlePath, target.data))
          : { ok: false as const };
      if (!archive.ok) {
        return errorJson(
          c,
          404,
          'runner_pty_missing',
          `No terminal PTY ${file} on this server (built for ${RunnerPtyTarget.options.join(', ')} by pnpm --filter @mwc/runner build)`,
        );
      }
      return c.body(archive.body, 200, {
        'content-type': 'application/gzip',
        'cache-control': 'no-store',
        [RUNNER_SHA256_HEADER]: archive.sha256,
      });
    });
}

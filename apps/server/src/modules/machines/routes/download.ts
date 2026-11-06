import {
  RUNNER_BUNDLE_PATH,
  RUNNER_INSTALL_SCRIPT_PATH,
  RUNNER_SHA256_HEADER,
} from '@mwc/shared/runner-protocol';
import type { ServerDeps } from '../../../platform/env.ts';
import { errorJson } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { DEFAULT_RUNNER_BUNDLE, readRunnerBundle } from '../service/download.ts';
import { INSTALL_SCRIPT } from '../service/install-script.ts';

/**
 * Installing a runner (S4.5, docs/machines.md "Installing a runner"): `GET /api/runner/install.sh`, the installer a
 * machine pipes into `sh`, and `GET /api/runner/runner.mjs`, the runner it downloads, with its SHA-256 in a header
 * (404 `runner_bundle_missing` until `pnpm --filter @mwc/runner build` made it). Both public: the enrollment token the
 * script is given is the secret. Not in the OpenAPI document: neither is JSON.
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
    });
}

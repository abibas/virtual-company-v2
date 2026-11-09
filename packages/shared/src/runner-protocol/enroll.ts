import { z } from 'zod';
import { MachineKind, MachineProvider } from '../enums.ts';
import { AiriaDevboxRef, MACHINE_NAME } from '../machines.ts';
import { ClaudeVersion, JsonObject, RunnerVersion, Uuid } from './common.ts';
import { RunnerKey } from './server-frames.ts';

/**
 * Enrolling a machine (docs/runner-protocol.md, "Enrollment"): the runner's `install --token` trades a one-time
 * enrollment token at `POST /api/runner/enroll` for the machine's id and its runner key. Plain HTTP with JSON bodies
 * (strict objects, unlike the frames): the token is the only credential.
 */

/** An enrollment token: `mwc_et_` and 32 base62 characters, shown once to the admin who made it. */
export const ENROLLMENT_TOKEN_PATTERN = /^mwc_et_[0-9A-Za-z]{32}$/;

/** How long an enrollment token can be used, once: an hour from when it was made. */
export const ENROLLMENT_TOKEN_TTL_MS = 60 * 60_000;

/** Where a runner enrolls. */
export const RUNNER_ENROLL_PATH = '/api/runner/enroll';

/**
 * The installer a machine runs (`curl -fsSL <server>/api/runner/install.sh | sh -s -- --server <server> --token …`),
 * the runner bundle it downloads, and the response header with the bundle's SHA-256 (hex), which it checks (S4.5).
 * Both are public: the enrollment token passed to the script is the secret.
 */
export const RUNNER_INSTALL_SCRIPT_PATH = '/api/runner/install.sh';
export const RUNNER_BUNDLE_PATH = '/api/runner/runner.mjs';
export const RUNNER_SHA256_HEADER = 'x-mwc-runner-sha256';
/**
 * The bundle's manifest, `runner.json` (`{ version, builtAt, sha256 }`, with its own SHA-256 in `RUNNER_SHA256_HEADER`):
 * the bundle carries no build time, so the installer and the self-update put this beside it and the runner reads its
 * build time from there.
 */
export const RUNNER_MANIFEST_PATH = '/api/runner/runner.json';

/**
 * The systems whose terminal PTY the server hands out (`<platform>-<arch>`, as Node names them): the prebuilt node-pty
 * the runner loads for its terminals (docs/machines.md, "Terminal"). The installer downloads its machine's at
 * `RUNNER_PTY_PATH/<target>.tgz`, with its SHA-256 in `RUNNER_SHA256_HEADER`, and unpacks it next to the runner.
 */
export const RUNNER_PTY_TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'] as const;
export const RunnerPtyTarget = z.enum(RUNNER_PTY_TARGETS);
export type RunnerPtyTarget = z.infer<typeof RunnerPtyTarget>;
export const RUNNER_PTY_PATH = '/api/runner/pty';

export const EnrollmentToken = z.string().regex(ENROLLMENT_TOKEN_PATTERN, 'an enrollment token (mwc_et_…)');

/** Free text a machine says about itself: `darwin`, `arm64`, its hostname, the runner's Unix user. */
const MachineText = (max: number) => z.string().min(1).max(max);

/**
 * What the installer sends: the token, the machine's name and kind, what it runs on, the runner's version and Claude
 * Code's (`claudeVersion` null without it), and what powers it: `airia_devbox` with its `AiriaDevboxRef`, or `none`
 * with a null `providerRef`.
 */
export const RunnerEnrollRequest = z
  .object({
    token: EnrollmentToken,
    name: z.string().trim().min(MACHINE_NAME.min).max(MACHINE_NAME.max),
    kind: MachineKind,
    os: MachineText(32),
    arch: MachineText(32),
    hostname: MachineText(255),
    unixUser: MachineText(64),
    runnerVersion: RunnerVersion,
    claudeVersion: ClaudeVersion.nullable(),
    provider: MachineProvider,
    providerRef: JsonObject.nullable(),
  })
  .superRefine((request, ctx) => {
    if (request.provider === 'none') {
      if (request.providerRef !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['providerRef'],
          message: 'null for a machine with no provider',
        });
      }
      return;
    }
    for (const issue of AiriaDevboxRef.safeParse(request.providerRef).error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', path: ['providerRef', ...issue.path], message: issue.message });
    }
  });
export type RunnerEnrollRequest = z.infer<typeof RunnerEnrollRequest>;

/** The answer (201): the machine's id, its company and its runner key, which is shown in this answer only. */
export const RunnerEnrollResponse = z.object({
  machineId: Uuid,
  companyId: Uuid,
  runnerKey: RunnerKey,
});
export type RunnerEnrollResponse = z.infer<typeof RunnerEnrollResponse>;

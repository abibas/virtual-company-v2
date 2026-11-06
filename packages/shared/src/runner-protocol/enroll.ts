import { z } from 'zod';
import { MachineKind, MachineProvider } from '../enums.ts';
import { AiriaDevboxRef, MACHINE_NAME } from '../machines.ts';
import { ClaudeVersion, JsonObject, RunnerVersion, Uuid } from './common.ts';
import { RunnerKey } from './server-frames.ts';

/**
 * Enrolling a machine (docs/runner-protocol.md, "Enrollment"): `mwc runner install --token` trades a one-time
 * enrollment token at `POST /api/runner/enroll` for the machine's id and its runner key. Plain HTTP with JSON bodies
 * (strict objects, unlike the frames): the token is the only credential.
 */

/** An enrollment token: `mwc_et_` and 32 base62 characters, shown once to the admin who made it. */
export const ENROLLMENT_TOKEN_PATTERN = /^mwc_et_[0-9A-Za-z]{32}$/;

/** How long an enrollment token can be used, once: an hour from when it was made. */
export const ENROLLMENT_TOKEN_TTL_MS = 60 * 60_000;

/** Where a runner enrolls. */
export const RUNNER_ENROLL_PATH = '/api/runner/enroll';

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

import { z } from 'zod';
import { ErrorText, frame, Uuid } from './common.ts';

/**
 * Updating a runner over its link (docs/machines.md, "Updating a runner"; S4, 2026-11-09): the build a runner runs (the
 * SHA-256 of its bundle, in `runner.hello`), and the server's `runner.update`, which an installed runner whose service
 * manager restarts it (`caps.selfUpdate`) carries out: it downloads the bundle and its system's PTY from its server,
 * checks their SHA-256 as `install.sh` does, puts them in place, answers `runner.update.result` and restarts. It trusts
 * the server over the authenticated link and checks SHA-256 only; the signed self-update stays in S8.
 */

/** A runner build: the SHA-256 (64 lower-case hex digits) of the `runner.mjs` it was started from. */
export const RunnerBuild = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 in lower-case hex');
export type RunnerBuild = z.infer<typeof RunnerBuild>;

/** When a runner bundle was built: a UTC ISO 8601 time, stamped in by the build next to its version. */
export const RunnerBuiltAt = z.iso.datetime();

/**
 * Why a runner did not update, the code before `: ` in `runner.update.result.error`: it cannot (`unsupported`: run from
 * its sources, in a container, or not under launchd or systemd), it has live work (`busy`), a download failed
 * (`download_failed`), a file did not match its SHA-256 (`hash_mismatch`), or the files could not be put in place
 * (`write_failed`; the old copy stays).
 */
export const RUNNER_UPDATE_ERRORS = [
  'unsupported',
  'busy',
  'download_failed',
  'hash_mismatch',
  'write_failed',
] as const;
export type RunnerUpdateError = (typeof RUNNER_UPDATE_ERRORS)[number];

/** Server to runner: update yourself from the server you are linked to, then restart. */
export const RunnerUpdate = frame('runner.update', {
  cmdId: Uuid,
});
export type RunnerUpdate = z.infer<typeof RunnerUpdate>;

/**
 * Runner to server, the answer to `runner.update` (instead of `cmd.ack`): `ok` once the new files are in place (the
 * runner restarts right after it), with the new `build`; otherwise why not, as `<code>: <words>`.
 */
export const RunnerUpdateResult = frame('runner.update.result', {
  cmdId: Uuid,
  ok: z.boolean(),
  build: RunnerBuild.optional(),
  error: ErrorText.optional(),
});
export type RunnerUpdateResult = z.infer<typeof RunnerUpdateResult>;

/** The code of a `runner.update.result` error (`busy: 1 live run` is `busy`); undefined for none or another text. */
export function updateErrorCode(error: string | undefined): RunnerUpdateError | undefined {
  const code = error?.split(':', 1)[0];
  return RUNNER_UPDATE_ERRORS.find((known) => known === code);
}

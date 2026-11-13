import type { Harness, PermissionMode } from '@mwc/shared/enums';
import {
  credentialFits,
  HARNESS_MODEL_PATTERN,
  HEADER_NAME_PATTERN,
  HEADER_VALUE_PATTERN,
  SESSION_ID_PATTERN,
  type TerminalSpec,
  type TurnSpec,
} from '@mwc/shared/harness';
import { fitsHarness, modeOfPolicy } from '@mwc/shared/modes';
import { HarnessError } from './errors.ts';
import { HARNESS_LABELS } from './lines.ts';

/**
 * The checks every driver runs before it builds a command line. The wire schemas of `@mwc/shared/harness` hold the
 * same rules; a driver checks again because what it builds goes to a process: an id that starts with `-` would be
 * read as an option, a header value with a newline would add a header.
 */

/** Refuses a terminal spec the driver of `harness` cannot start safely. */
export function checkSpec(harness: Harness, spec: TerminalSpec): void {
  const label = HARNESS_LABELS[harness];
  if (spec.harness !== harness) {
    throw new HarnessError('invalid_spec', `A ${HARNESS_LABELS[spec.harness]} turn cannot run on ${label}.`);
  }
  if (!credentialFits(harness, spec.credential.kind)) {
    throw new HarnessError(
      'credential_mismatch',
      `A ${spec.credential.kind} subscription cannot power ${label}.`,
    );
  }
  if (spec.sessionId !== null && !SESSION_ID_PATTERN.test(spec.sessionId)) {
    throw new HarnessError(
      'invalid_spec',
      'The session id is not one word of letters, digits and ._:- only.',
    );
  }
  if (spec.model !== null && !HARNESS_MODEL_PATTERN.test(spec.model)) {
    throw new HarnessError('invalid_spec', 'The model is not one word of letters, digits and ._:/@[]- only.');
  }
  for (const [name, value] of Object.entries(spec.gateway?.headers ?? {})) {
    if (!HEADER_NAME_PATTERN.test(name) || !HEADER_VALUE_PATTERN.test(value)) {
      throw new HarnessError('invalid_spec', 'A gateway header is not one line with a plain name.');
    }
  }
  if (spec.permissionMode !== undefined && !fitsHarness(harness, spec.permissionMode)) {
    throw new HarnessError('invalid_spec', `${label} has no mode ${spec.permissionMode}.`);
  }
}

/**
 * The permission mode a spec runs in (docs/harness.md "Modes"): its `permissionMode`, else the one its old
 * `permissionPolicy` meant on its harness (a server older than the modes: Skip prompts or Full trust for `bypass`; for
 * `ask`, Manual on Claude Code and Auto on Codex, `modeOfPolicy`).
 */
export const specMode = (spec: TerminalSpec): PermissionMode =>
  spec.permissionMode ?? modeOfPolicy(spec.harness, spec.permissionPolicy);

/**
 * Refuses a turn spec the driver of `harness` cannot start safely: the terminal's checks, an empty prompt, and a
 * message to resume up to that is not one word or comes without a fork of a session (resuming up to a message without
 * forking would cut the original conversation short).
 */
export function checkTurn(harness: Harness, spec: TurnSpec): void {
  checkSpec(harness, spec);
  if (spec.prompt.trim() === '') throw new HarnessError('invalid_spec', 'The message is empty.');
  if (spec.resumeAt === undefined) return;
  if (!SESSION_ID_PATTERN.test(spec.resumeAt)) {
    throw new HarnessError(
      'invalid_spec',
      'The message id is not one word of letters, digits and ._:- only.',
    );
  }
  if (spec.forkSession !== true || spec.sessionId === null) {
    throw new HarnessError('invalid_spec', 'A message to resume up to needs a session to fork.');
  }
}

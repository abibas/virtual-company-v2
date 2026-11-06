/** What went wrong in a power call; callers branch on `code`, never on messages. */
export const MACHINE_POWER_ERROR_CODES = [
  /** The controller's cloud sign-in is missing or expired (for the devbox: `gcloud auth login` on This Mac). */
  'needs_gcloud_login',
  /** The provider's command-line tool is not installed, or not on the controller's PATH. */
  'cli_missing',
  /** The provider has no such machine. */
  'not_found',
  /** The cloud has no capacity for the machine in its zone, or the region's quota is full. */
  'stockout_or_quota',
  /** The command did not finish in time; the machine may still be changing state. */
  'timeout',
  /** Anything else: the command failed for a reason the driver does not recognize. */
  'failed',
] as const;
export type MachinePowerErrorCode = (typeof MACHINE_POWER_ERROR_CODES)[number];

/** A plain-words message for each code, the error's message when the driver has nothing more specific. */
export const MACHINE_POWER_ERROR_MESSAGES: Readonly<Record<MachinePowerErrorCode, string>> = {
  needs_gcloud_login:
    'The Google Cloud sign-in on the controlling machine is missing or has expired. Run `gcloud auth login` there.',
  cli_missing:
    'The tool that powers this machine (airia or gcloud) is not installed on the controlling machine.',
  not_found: 'The machine does not exist at its provider.',
  stockout_or_quota:
    'The cloud has no room for this machine right now (no capacity in its zone, or the region’s quota is full). Try again later.',
  timeout: 'The power command took too long; the machine may still be starting or stopping.',
  failed: 'The power command failed.',
};

export interface MachinePowerErrorOptions {
  /** A short, token-free excerpt of the provider's output (its last error line), for the log. */
  readonly detail?: string;
  readonly cause?: unknown;
}

/** The one error type every `MachinePowerDriver` method rejects with. */
export class MachinePowerError extends Error {
  readonly code: MachinePowerErrorCode;
  readonly detail: string | undefined;

  constructor(code: MachinePowerErrorCode, message?: string, options: MachinePowerErrorOptions = {}) {
    super(
      message ?? MACHINE_POWER_ERROR_MESSAGES[code],
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'MachinePowerError';
    this.code = code;
    this.detail = options.detail;
  }

  /** `stockout_or_quota` and `timeout`: the same call may succeed later. */
  get retryable(): boolean {
    return this.code === 'stockout_or_quota' || this.code === 'timeout';
  }
}

/** True for a `MachinePowerError`, optionally of one code. */
export function isMachinePowerError(
  error: unknown,
  code?: MachinePowerErrorCode,
): error is MachinePowerError {
  return error instanceof MachinePowerError && (code === undefined || error.code === code);
}

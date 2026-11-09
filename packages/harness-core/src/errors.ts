/** What a driver refused; callers branch on `code`, never on messages. */
export const HARNESS_ERROR_CODES = [
  /** The credential is of the other harness's family (an OpenAI login for Claude Code). */
  'credential_mismatch',
  /** The spec cannot become a safe command line: another harness's turn, a session id or model that is not one word, a header on two lines, an empty prompt. */
  'invalid_spec',
] as const;
export type HarnessErrorCode = (typeof HARNESS_ERROR_CODES)[number];

/** A plain-words message for each code, the error's message when the driver has nothing more specific. */
export const HARNESS_ERROR_MESSAGES: Readonly<Record<HarnessErrorCode, string>> = {
  credential_mismatch: 'This subscription cannot power this harness.',
  invalid_spec: 'This turn cannot be started as it is.',
};

/** The one error type a `HarnessDriver` throws. */
export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message?: string) {
    super(message ?? HARNESS_ERROR_MESSAGES[code]);
    this.name = 'HarnessError';
    this.code = code;
  }
}

/** True for a `HarnessError`, optionally of one code. */
export function isHarnessError(error: unknown, code?: HarnessErrorCode): error is HarnessError {
  return error instanceof HarnessError && (code === undefined || error.code === code);
}

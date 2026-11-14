// @mwc/harness-core: the harness driver port (docs/harness.md), loaded by the runner with its connectors
// (@mwc/harness-claude-code, @mwc/harness-codex); the wire contracts it uses are @mwc/shared/harness. The test doubles
// are a separate import: @mwc/harness-core/fake (FakeHarnessDriver, the fake binary).

export type {
  HarnessCredential,
  HarnessGateway,
  TerminalSpec,
  TurnEvent,
  TurnEventOf,
  TurnSpec,
} from '@mwc/shared/harness';
export { checkSpec, checkTurn, specMode } from './checks.ts';
export {
  ASK_SOCKET_ENV,
  ASK_TOKEN_ENV,
  type HarnessDriver,
  type LineParser,
  PARSER_TICK_MS,
  type ParserContext,
  type PrivateDir,
  type PrivateFile,
  type ProcessSpec,
  SERVER_TOOLS_ENV,
  TOOLS_ENV,
  type TurnNotice,
  type TurnTools,
} from './driver.ts';
export {
  HARNESS_ERROR_CODES,
  HARNESS_ERROR_MESSAGES,
  HarnessError,
  type HarnessErrorCode,
  isHarnessError,
} from './errors.ts';
export {
  countOf,
  failedResult,
  HARNESS_LABELS,
  isRecord,
  type JsonRecord,
  parseJsonLine,
  stringOf,
} from './lines.ts';
export { lineMatching, SESSION_MISSING_LINE_MAX } from './missing.ts';
export { clipHead, clipLine, clipMarked, clipTail, inputText, outputText } from './text.ts';

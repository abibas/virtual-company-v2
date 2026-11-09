// @mwc/harness-claude-code: the Claude Code harness (docs/harness.md), loaded by the runner, never by the server.
// The recorded-style turns for tests are a separate import: @mwc/harness-claude-code/fixtures.
export {
  CLAUDE_ACCOUNT_VARS,
  CLAUDE_COMMAND,
  claudeEnv,
  credentialEnv,
  customHeaders,
  sharedArgs,
  TURN_ARGS,
  unsetFor,
} from './args.ts';
export { ClaudeCodeDriver, type ClaudeCodeDriverOptions } from './driver.ts';
export { assistantEvents, resultEvents, systemEvents, userEvents } from './messages.ts';
export { ClaudeLineParser } from './parser.ts';
export { denialNotice, resultSummary, resultText, toolSummary } from './summary.ts';

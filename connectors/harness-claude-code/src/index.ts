// @mwc/harness-claude-code: the Claude Code harness (docs/harness.md), loaded by the runner, never by the server.
// The recorded-style turns for tests are a separate import: @mwc/harness-claude-code/fixtures.
export {
  ASK_PROMPT,
  CLAUDE_ACCOUNT_VARS,
  CLAUDE_COMMAND,
  claudeEnv,
  credentialEnv,
  customHeaders,
  MCP_CONFIG_FILE,
  mcpConfig,
  sharedArgs,
  TURN_ARGS,
  toolArgs,
  unsetFor,
} from './args.ts';
export { contextEvents, forgetContext, resultContext } from './context.ts';
export { ClaudeCodeDriver, type ClaudeCodeDriverOptions } from './driver.ts';
export { INPUT_ARGS, inputEvent, isReplay, userLine } from './input.ts';
export { assistantEvents, resultEvents, todoEvent, userEvents } from './messages.ts';
export { ClaudeLineParser } from './parser.ts';
export { type ClaudeState, newClaudeState, parentOf, type SubagentState } from './state.ts';
export {
  interruptedSubagents,
  SUBAGENT_TOOLS,
  subagentAnswered,
  subagentStarted,
  taskEvents,
} from './subagents.ts';
export { denialNotice, resultSummary, resultText, toolSummary } from './summary.ts';
export { systemEvents } from './system.ts';

import { z } from 'zod';
import { InstallableTool } from '../machines.ts';
import { ErrorText, frame, protocolObject, Uuid } from './common.ts';

/**
 * A machine's tools (docs/machines.md "Tools", 2026-11-10): the CLIs a runner reports in its caps (`caps.tools`: each
 * one's version, found as the harnesses are, without a process for a missing one), the server's `tools.check` (look
 * again) and `tools.install` (npm installs Claude Code or Codex into the runner user's `~/.local`), the install's output
 * lines (`tools.output`) and the answer to both (`tools.result`, instead of `cmd.ack`). After either the runner also
 * sends `runner.caps` (`runner-frames.ts`) before its answer, so the server's view of it is fresh when the answer comes.
 * A runner that says `caps.tools` knows these frames; an older one acks them as commands it does not know.
 */

/** What a CLI's `--version` printed first (`2.1.319 (Claude Code)`, `git version 2.39.5`). */
export const ToolVersion = z.string().min(1).max(100);

/** `caps.tools`: each CLI's version, null when it is not found; a CLI this side does not know yet is null. */
export const RunnerTools = protocolObject({
  claude: ToolVersion.nullable().default(null),
  codex: ToolVersion.nullable().default(null),
  git: ToolVersion.nullable().default(null),
  gh: ToolVersion.nullable().default(null),
  docker: ToolVersion.nullable().default(null),
});
export type RunnerTools = z.infer<typeof RunnerTools>;

/** How long a runner lets `npm install` run before it kills it (`timeout`). */
export const TOOLS_INSTALL_TIMEOUT_MS = 10 * 60_000;

/** How long the server waits for the answer to `tools.check`: each `--version` may take up to 30 s. */
export const TOOLS_CHECK_TIMEOUT_MS = 45_000;

/** The longest `tools.output` line (longer ones are cut), and the most lines one install sends (then one notice). */
export const TOOL_OUTPUT_LINE_MAX = 500;
export const TOOL_OUTPUT_LINES_MAX = 500;

/**
 * Why a runner did not install, the code before `: ` in `tools.result.error`: it cannot here (`unsupported`: a
 * container, whose image is rebuilt instead, or a runner without the tools), another install runs (`busy`), there is no
 * npm beside its Node (`npm_missing`), npm ran past `TOOLS_INSTALL_TIMEOUT_MS` (`timeout`), or npm failed (`failed`).
 */
export const TOOL_INSTALL_ERRORS = ['unsupported', 'busy', 'npm_missing', 'timeout', 'failed'] as const;
export type ToolInstallError = (typeof TOOL_INSTALL_ERRORS)[number];

/** An exact npm version (`2.1.308`, `1.0.0-beta.1`): no range, no tag. */
export const PackageVersion = z
  .string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'an exact version such as 2.1.308');

/** Server to runner: look for every CLI again and ask each one found its version. */
export const ToolsCheck = frame('tools.check', {
  cmdId: Uuid,
});
export type ToolsCheck = z.infer<typeof ToolsCheck>;

/**
 * Server to runner: install `tool` at `version` (the server's pin, `TOOL_PACKAGES`) with the npm beside the runner's
 * Node, into `~/.local` (its command lands in `~/.local/bin`), never with sudo; one install at a time.
 */
export const ToolsInstall = frame('tools.install', {
  cmdId: Uuid,
  tool: InstallableTool,
  version: PackageVersion,
});
export type ToolsInstall = z.infer<typeof ToolsInstall>;

/** Runner to server: one line npm printed for the install `cmdId` (at most `TOOL_OUTPUT_LINES_MAX` of them). */
export const ToolsOutput = frame('tools.output', {
  cmdId: Uuid,
  line: z.string().max(TOOL_OUTPUT_LINE_MAX),
});
export type ToolsOutput = z.infer<typeof ToolsOutput>;

/**
 * Runner to server, the answer to `tools.check` and `tools.install` (instead of `cmd.ack`): `ok` and the versions it
 * found after looking again; or why not, as `<code>: <words>` (with the versions when it knows them).
 */
export const ToolsResult = frame('tools.result', {
  cmdId: Uuid,
  ok: z.boolean(),
  tools: RunnerTools.optional(),
  error: ErrorText.optional(),
});
export type ToolsResult = z.infer<typeof ToolsResult>;

/** The code of a `tools.result` error (`busy: codex is being installed` is `busy`); `failed` for any other text. */
export function toolInstallErrorCode(error: string | undefined): ToolInstallError {
  const code = error?.split(':', 1)[0];
  return TOOL_INSTALL_ERRORS.find((known) => known === code) ?? 'failed';
}

/** The tools frames the server sends, and the ones a runner answers with. */
export const TOOL_SERVER_FRAMES = [ToolsCheck, ToolsInstall] as const;
export const TOOL_RUNNER_FRAMES = [ToolsOutput, ToolsResult] as const;

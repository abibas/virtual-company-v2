import { z } from 'zod';
import { STANDING_INSTRUCTIONS_MAX } from '../agent-briefing.ts';
import { GATEWAY_HEADERS, PROVIDER_KINDS, SECRET_MAX } from '../credentials.ts';
import { type CredentialKind, Effort, Harness, PermissionMode, PermissionPolicy } from '../enums.ts';
import { ArtifactsDir } from '../flows/artifacts.ts';
import { AgentToolName, TURN_TOOLS_MAX } from '../flows/tools.ts';
import { PlacementPath } from '../machines.ts';
import { MODEL_ID_PATTERN, ModelId } from '../models.ts';
import { protocolObject } from '../runner-protocol/common.ts';
import { ServerToolDefs } from './server-tools.ts';

/**
 * What the server asks a runner to start (docs/harness.md): one chat turn (`TurnSpec`, with the credential it resolved
 * from the agent's access profile) or the interactive terminal (`TerminalSpec`), and the words they put on a command
 * line. The events a turn gives back are `events.ts`'s.
 */

/** The credential kinds each harness runs on: a Claude profile's subscription for Claude Code, an OpenAI one's for Codex. */
export const HARNESS_CREDENTIAL_KINDS = {
  claude_code: PROVIDER_KINDS.claude,
  codex: PROVIDER_KINDS.openai,
} as const satisfies Record<Harness, readonly CredentialKind[]>;

/** True when a credential of `kind` can power `harness`. */
export function credentialFits(harness: Harness, kind: CredentialKind): boolean {
  return (HARNESS_CREDENTIAL_KINDS[harness] as readonly CredentialKind[]).includes(kind);
}

/** The largest Codex `auth.json` a turn carries. */
export const CODEX_AUTH_JSON_MAX = 64 * 1024;

const Secret = z.string().min(1).max(SECRET_MAX);

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** A Codex login's `auth.json`, as its text: a JSON object of at most `CODEX_AUTH_JSON_MAX` characters. */
export const CodexAuthJson = z.string().max(CODEX_AUTH_JSON_MAX).refine(isJsonObject, 'a JSON object');

/**
 * The secret a turn runs on, opened by the server for this turn only: a Claude login's access token or a setup-token
 * (both `CLAUDE_CODE_OAUTH_TOKEN`), an Anthropic API key, a Codex login's `auth.json` (as its text), an OpenAI API key.
 */
export const HarnessCredential = z.discriminatedUnion('kind', [
  protocolObject({ kind: z.literal('claude_oauth'), token: Secret }),
  protocolObject({ kind: z.literal('claude_setup_token'), token: Secret }),
  protocolObject({ kind: z.literal('anthropic_api_key'), key: Secret }),
  protocolObject({ kind: z.literal('codex_oauth'), authJson: CodexAuthJson }),
  protocolObject({ kind: z.literal('openai_api_key'), key: Secret }),
]);
export type HarnessCredential = z.infer<typeof HarnessCredential>;
export type HarnessCredentialKind = HarnessCredential['kind'];

/** An HTTP header's name: the token characters of RFC 9110, at most 100 of them. */
export const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

/** An HTTP header's value: one line (a newline would add a header of its own). */
export const HEADER_VALUE_PATTERN = /^[^\r\n\0]*$/;

/** The AI gateway a turn's requests go through: its address and the headers sent with each request. */
export const HarnessGateway = protocolObject({
  baseUrl: z.url({ protocol: /^https?$/ }).max(2048),
  headers: z
    .record(
      z.string().regex(HEADER_NAME_PATTERN, 'a header name'),
      z.string().max(SECRET_MAX).regex(HEADER_VALUE_PATTERN, 'a header value on one line'),
    )
    .refine(
      (headers) => Object.keys(headers).length <= GATEWAY_HEADERS.max,
      `at most ${GATEWAY_HEADERS.max} headers`,
    ),
});
export type HarnessGateway = z.infer<typeof HarnessGateway>;

/**
 * A harness's conversation id (Claude Code's session id, Codex's thread id): it goes on the command line, so it is one
 * word that cannot be read as an option.
 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const HarnessSessionId = z.string().regex(SESSION_ID_PATTERN, 'a session id');

/**
 * A message id in a harness's conversation (Claude Code's message uuid): where a branch from an earlier reply resumes up
 * to (`--resume-session-at`); one word on the command line, like a session id.
 */
export const HarnessMessageId = z.string().regex(SESSION_ID_PATTERN, 'a message id');

/** A model id or alias (`opus`, `claude-opus-5-5[1m]`, `gpt-6.1-sol`), on the command line too (the catalogue's). */
export const HARNESS_MODEL_PATTERN = MODEL_ID_PATTERN;
export const HarnessModel = ModelId;

const sessionFields = {
  harness: Harness,
  /** The agent's home folder on its machine: the process starts there. */
  cwd: PlacementPath,
  /** The conversation to resume; null starts a new one. */
  sessionId: HarnessSessionId.nullable(),
  /** Null leaves the harness's own default. */
  model: HarnessModel.nullable(),
  effort: Effort.optional(),
  /**
   * The old two-way setting, for a runner older than the modes: `bypass` for a mode that never asks, else `ask`
   * (`policyOfMode` of `@mwc/shared/modes`).
   */
  permissionPolicy: PermissionPolicy,
  /**
   * The permission mode (2026-11-13, docs/harness.md "Modes"): one of the harness's (`fitsHarness`), the profile's or the
   * chat's override. Absent: the one `permissionPolicy` meant (`modeOfPolicy`); a runner older than it ignores it.
   */
  permissionMode: PermissionMode.optional(),
  /** The harness's config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`); null for the default (docs/harness.md). */
  configDir: PlacementPath.nullable(),
  credential: HarnessCredential,
  gateway: HarnessGateway.nullable(),
  /**
   * The standing instructions every turn and terminal gets (docs/harness.md, "Standing instructions"): the agent's place
   * in the company, generated from the chart, then its own instructions. Absent: none; a runner older than the field
   * passes it through untouched and its driver ignores it.
   */
  instructions: z.string().min(1).max(STANDING_INSTRUCTIONS_MAX).optional(),
};

/** The interactive terminal of a conversation: the harness's own TUI, resuming `sessionId` or starting a new one. */
export const TerminalSpec = protocolObject(sessionFields);
export type TerminalSpec = z.infer<typeof TerminalSpec>;

/**
 * A task step's outputs (S5.3b, docs/harness.md "Task turns"): the folder under the agent's home folder (`cwd`) the
 * runner makes before the turn and collects new or changed files from when it ends (`turn.artifact` frames, then
 * `turn.artifacts`). A runner older than it passes it through and collects nothing.
 */
export const TurnArtifactsSpec = protocolObject({ dir: ArtifactsDir });
export type TurnArtifactsSpec = z.infer<typeof TurnArtifactsSpec>;

/**
 * The agents' tools a turn gets (S6a, docs/harness.md "Agents' tools"): a task step's by its kind, a flow Lead's in its
 * own chats, by name (`AgentTool` of `@mwc/shared/flows`). The runner's MCP server offers these besides its question
 * tool and relays their calls (`turn.tool`); a name the runner does not know is passed over. Sent only to a runner that
 * says `caps.agentTools`; an older one would ignore it.
 */
export const TurnToolNames = z
  .array(AgentToolName)
  .max(TURN_TOOLS_MAX)
  .refine((names) => new Set(names).size === names.length, 'each tool once');

/**
 * One chat turn: `prompt` (the message, verbatim) sent to the conversation, as one process. A branch's first turn
 * (docs/harness.md "Branching") resumes `sessionId` forked (`forkSession`: a new conversation from a copy, the original
 * untouched), with Claude Code up to `resumeAt` (a message id) when it continues from an earlier reply; absent: false,
 * none. A turn of a task's step (S5.3b) names its outputs' folder (`artifacts`); one with the agents' tools (S6a) names
 * them (`tools`); one with the server's own tools (S7.1c, only to a runner that says `caps.serverTools`) carries them
 * whole (`serverTools`).
 */
export const TurnSpec = protocolObject({
  ...sessionFields,
  prompt: z.string().min(1),
  forkSession: z.boolean().optional(),
  resumeAt: HarnessMessageId.optional(),
  artifacts: TurnArtifactsSpec.optional(),
  tools: TurnToolNames.optional(),
  serverTools: ServerToolDefs.optional(),
});
export type TurnSpec = z.infer<typeof TurnSpec>;

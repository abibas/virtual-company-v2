import { z } from 'zod';
import { GATEWAY_HEADERS, PROFILE_SLOT_KINDS, SECRET_MAX } from './credentials.ts';
import { type CredentialKind, Effort, Harness, PermissionPolicy } from './enums.ts';
import { PlacementPath } from './machines.ts';
import { AGENT_MODEL_MAX } from './org.ts';
import { protocolObject } from './runner-protocol/common.ts';

/**
 * One chat turn of a harness, as the server and a runner exchange it (docs/harness.md): the turn the server asks for
 * (`TurnSpec`, with the credential it resolved from the agent's access profile), the interactive terminal it opens
 * (`TerminalSpec`), and the normalized events a runner sends back (`TurnEvent`). `@mwc/harness-core` builds on these;
 * the server reads them from here, so it never imports a harness package.
 */

/** The credential kinds each harness runs on: an access profile's Claude slot for Claude Code, its OpenAI slot for Codex. */
export const HARNESS_CREDENTIAL_KINDS = {
  claude_code: PROFILE_SLOT_KINDS.claude,
  codex: PROFILE_SLOT_KINDS.openai,
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

/** A model id or alias (`opus`, `claude-opus-5-5[1m]`, `gpt-5.6-codex`), on the command line too. */
export const HARNESS_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]*$/;
export const HarnessModel = z.string().max(AGENT_MODEL_MAX).regex(HARNESS_MODEL_PATTERN, 'a model id');

const sessionFields = {
  harness: Harness,
  /** The agent's home folder on its machine: the process starts there. */
  cwd: PlacementPath,
  /** The conversation to resume; null starts a new one. */
  sessionId: HarnessSessionId.nullable(),
  /** Null leaves the harness's own default. */
  model: HarnessModel.nullable(),
  effort: Effort.optional(),
  permissionPolicy: PermissionPolicy,
  /** The harness's config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`); null for the default (docs/harness.md). */
  configDir: PlacementPath.nullable(),
  credential: HarnessCredential,
  gateway: HarnessGateway.nullable(),
};

/** The interactive terminal of a conversation: the harness's own TUI, resuming `sessionId` or starting a new one. */
export const TerminalSpec = protocolObject(sessionFields);
export type TerminalSpec = z.infer<typeof TerminalSpec>;

/** One chat turn: `prompt` (the message, verbatim) sent to the conversation, as one process. */
export const TurnSpec = protocolObject({ ...sessionFields, prompt: z.string().min(1) });
export type TurnSpec = z.infer<typeof TurnSpec>;

/** The longest one-line summary of a tool call's input. */
export const TOOL_SUMMARY_MAX = 200;
/** The longest summary of a tool call's result. */
export const TOOL_RESULT_SUMMARY_MAX = 500;
/** The longest notice. */
export const NOTICE_MAX = 2000;
/** The longest error of a failed turn. */
export const RESULT_ERROR_MAX = 2000;

const Count = z.int().nonnegative();
const ToolId = z.string().min(1).max(200);

export const NoticeLevel = z.enum(['info', 'warn']);
export type NoticeLevel = z.infer<typeof NoticeLevel>;

/**
 * What a turn's output means, the same for every harness: the conversation's id, the assistant's text, a tool call
 * and its result (summaries only), the tokens used, a notice for the person (a tool refused for permission), and the
 * turn's end. A runner sends them in order as `turn.events`, numbered from 1 (docs/runner-protocol.md, "Chat turns").
 */
export const TurnEvent = z.discriminatedUnion('type', [
  protocolObject({ type: z.literal('session'), sessionId: HarnessSessionId }),
  protocolObject({ type: z.literal('text'), text: z.string().min(1) }),
  protocolObject({
    type: z.literal('tool'),
    id: ToolId,
    name: z.string().min(1).max(200),
    summary: z.string().max(TOOL_SUMMARY_MAX),
  }),
  protocolObject({
    type: z.literal('tool_result'),
    id: ToolId,
    ok: z.boolean(),
    summary: z.string().max(TOOL_RESULT_SUMMARY_MAX),
  }),
  protocolObject({
    type: z.literal('usage'),
    /** Every input token, cached ones included. */
    inputTokens: Count,
    outputTokens: Count,
    /** The input tokens read from the prompt cache. */
    cachedInputTokens: Count.optional(),
    costUsd: z.number().nonnegative().optional(),
  }),
  protocolObject({
    type: z.literal('notice'),
    level: NoticeLevel,
    message: z.string().min(1).max(NOTICE_MAX),
  }),
  protocolObject({
    type: z.literal('result'),
    ok: z.boolean(),
    /** The reply: the turn's last assistant message. */
    text: z.string().optional(),
    error: z.string().min(1).max(RESULT_ERROR_MAX).optional(),
    durationMs: Count.optional(),
  }),
]);
export type TurnEvent = z.infer<typeof TurnEvent>;
export type TurnEventType = TurnEvent['type'];
export type TurnEventOf<T extends TurnEventType> = Extract<TurnEvent, { type: T }>;

/** Every event type, in the order a turn usually shows them. */
export const TURN_EVENT_TYPES = [
  'session',
  'text',
  'tool',
  'tool_result',
  'usage',
  'notice',
  'result',
] as const satisfies readonly TurnEventType[];

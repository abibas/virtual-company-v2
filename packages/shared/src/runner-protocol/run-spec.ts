import { z } from 'zod';
import { Effort, Harness } from '../enums.ts';
import { AGENT_MODEL_MAX } from '../org.ts';
import { protocolObject, Uuid } from './common.ts';

/**
 * What `run.start` asks a runner to run (docs/architecture.md, section 8). Big texts (the system prompt, the inputs)
 * are bounded by the frame limit alone. `secrets` reach the harness's environment only: the runner strips them before
 * it writes `spec.json`, and never journals them.
 */

/** A path on the runner's machine: absolute, or under the runner user's home (`~/airia-dev`). */
export const MachinePath = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^(\/|~(\/|$))/, 'an absolute path or one under ~');

/** Where the run works: the agent's home folder, its harness config folder, the task's worktree. */
export const RunPlacement = protocolObject({
  home: MachinePath,
  /** The harness's config folder (`CLAUDE_CONFIG_DIR`); null for the runner's own per-agent folder. */
  configDir: MachinePath.nullable(),
  /** The task's worktree (`--add-dir`); null for a run without one. */
  worktree: MachinePath.nullable(),
});
export type RunPlacement = z.infer<typeof RunPlacement>;

const SessionId = z.string().min(1).max(200);

/** A new conversation (with the id the server picked for it, or the harness's own), or the next turn of one. */
export const RunSession = z.discriminatedUnion('mode', [
  protocolObject({ mode: z.literal('new'), sessionId: SessionId.nullable() }),
  protocolObject({ mode: z.literal('resume'), sessionId: SessionId }),
]);
export type RunSession = z.infer<typeof RunSession>;

/** `ask`: every tool call outside the allowed ones asks a person (the permission tool); `bypass`: none asks. */
export const PermissionPolicy = z.enum(['ask', 'bypass']);
export type PermissionPolicy = z.infer<typeof PermissionPolicy>;

/** A message for the run, verbatim; `inputId` is the server's `run_inputs` row (the delivery receipt's key). */
export const RunInputText = protocolObject({
  inputId: Uuid,
  text: z.string().min(1),
});
export type RunInputText = z.infer<typeof RunInputText>;

/** An environment variable's name. */
export const EnvName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, 'an environment variable name');

/** The most secrets one run gets. */
export const RUN_SECRETS_MAX = 64;

/** The run's secrets, as environment variables (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, …). */
export const RunSecrets = z
  .record(EnvName, z.string())
  .refine((secrets) => Object.keys(secrets).length <= RUN_SECRETS_MAX, `at most ${RUN_SECRETS_MAX} secrets`);
export type RunSecrets = z.infer<typeof RunSecrets>;

/** Caps the runner enforces; an absent one is no cap. */
export const RunLimits = protocolObject({
  /** The most turns the harness takes (Claude Code's `--max-turns`). */
  maxTurns: z.int().min(1).optional(),
  /** The longest the run may last, awake time; then the runner stops it gracefully. */
  maxDurationMs: z.int().min(1).optional(),
});
export type RunLimits = z.infer<typeof RunLimits>;

export const RunSpec = protocolObject({
  runId: Uuid,
  companyId: Uuid,
  agentId: Uuid,
  /** The task the run works on; null for a run outside a task. */
  taskId: Uuid.nullable(),
  harness: Harness,
  placement: RunPlacement,
  session: RunSession,
  model: z.string().min(1).max(AGENT_MODEL_MAX),
  effort: Effort,
  permissionPolicy: PermissionPolicy,
  /** Appended to the harness's own system prompt (`--append-system-prompt-file`). */
  systemPrompt: z.string(),
  /** The messages not yet delivered, in order. */
  inputs: z.array(RunInputText),
  secrets: RunSecrets,
  /** The run's own token for its MCP and API calls back to the server. */
  runToken: z.string().min(16).max(512),
  limits: RunLimits,
});
export type RunSpec = z.infer<typeof RunSpec>;

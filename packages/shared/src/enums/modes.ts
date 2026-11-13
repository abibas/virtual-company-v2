import { z } from 'zod';

/**
 * The stored permission modes (2026-11-13, docs/subscriptions.md "Mode"), re-exported by `../enums.ts` with the other
 * database enums: each AI part's own, either harness's, and the old two-way setting still on the wire. Their words and
 * rules are `../modes.ts`'s.
 */

/**
 * The old two-way permission setting, still on the wire (`TurnSpec.permissionPolicy`) for runners older than the modes:
 * `bypass` for a mode with no prompts (Skip prompts, Full trust), `ask` for the rest (`policyOfMode` of
 * `@mwc/shared/modes`). Until 2026-11-13 it was the placement's (`agent_placements.permission_policy`).
 */
export const PermissionPolicy = z.enum(['ask', 'bypass']);
export type PermissionPolicy = z.infer<typeof PermissionPolicy>;

/**
 * `access_profiles.claude_mode` (2026-11-13, docs/subscriptions.md "Mode"): Claude Code's permission mode, by its own
 * `--permission-mode` values: Manual, Accept edits, Plan, Auto, Skip prompts (full trust).
 */
export const ClaudeMode = z.enum(['manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
export type ClaudeMode = z.infer<typeof ClaudeMode>;

/**
 * `access_profiles.openai_mode` (2026-11-13): Codex's approvals and sandbox in three steps: Ask (a read-only sandbox:
 * it asks before acting), Auto (acts in the workspace, asks for anything outside), Full trust (no prompts, no sandbox).
 */
export const CodexMode = z.enum(['ask', 'auto', 'full']);
export type CodexMode = z.infer<typeof CodexMode>;

/** Either harness's mode (`chats.mode`, `chat_turns.mode`, `TurnSpec.permissionMode`); which ones fit, its harness says. */
export const PermissionMode = z.enum([
  'manual',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
  'ask',
  'full',
]);
export type PermissionMode = z.infer<typeof PermissionMode>;

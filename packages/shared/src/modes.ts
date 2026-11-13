import { HARNESS_PROVIDER } from './credentials.ts';
import {
  ClaudeMode,
  CodexMode,
  type Harness,
  type PermissionMode,
  type PermissionPolicy,
  type ProfileProvider,
} from './enums.ts';

/**
 * The permission modes (2026-11-13, docs/subscriptions.md "Mode", docs/harness.md "Modes"): each AI part of a profile
 * runs its turns in one, and a chat may run its next turns in another (its override). Claude Code's are its own
 * `--permission-mode` values; Codex's are three steps of its approvals and sandbox. Each with the label the pages show,
 * a short one for narrow places (the docked chat), and one line of what it does, as Claude's own mode menu words them.
 * In a chat turn nobody answers a prompt: what would ask is refused, and the model and the thread are told.
 */

/** One mode as the pages show it. */
export interface ModeChoice<M extends PermissionMode = PermissionMode> {
  readonly id: M;
  readonly label: string;
  /** For narrow places: the docked chat's composer. */
  readonly short: string;
  readonly description: string;
}

/** Claude Code's modes, in the order the menus list them. */
const CLAUDE_MODES: readonly ModeChoice<ClaudeMode>[] = [
  { id: 'manual', label: 'Manual', short: 'Manual', description: 'Asks before each edit and command' },
  {
    id: 'acceptEdits',
    label: 'Accept edits',
    short: 'Edits',
    description: 'Edits files without asking; asks before commands',
  },
  { id: 'plan', label: 'Plan', short: 'Plan', description: 'Explores and writes a plan; changes nothing' },
  {
    id: 'auto',
    label: 'Auto',
    short: 'Auto',
    description: 'Runs safe actions itself; asks before risky ones',
  },
  {
    id: 'bypassPermissions',
    label: 'Skip prompts (full trust)',
    short: 'Full trust',
    description: 'Never asks: runs every tool',
  },
];

/** Codex's modes, in the order the menus list them. */
const CODEX_MODES: readonly ModeChoice<CodexMode>[] = [
  { id: 'ask', label: 'Ask', short: 'Ask', description: 'Reads only; asks before any change' },
  { id: 'auto', label: 'Auto', short: 'Auto', description: 'Works in its folder; asks for anything outside' },
  { id: 'full', label: 'Full trust', short: 'Full trust', description: 'Never asks: no prompts, no sandbox' },
];

/** Each AI part's modes. */
export const MODES: Readonly<Record<ProfileProvider, readonly ModeChoice[]>> = {
  claude: CLAUDE_MODES,
  openai: CODEX_MODES,
};

/** Each AI part's modes as zod enums (a profile's Claude part takes Claude Code's, its OpenAI part Codex's). */
export const PROVIDER_MODES = { claude: ClaudeMode, openai: CodexMode } as const;

/** A new AI part's mode, and the profile's when nothing else says: Manual for Claude, Ask for OpenAI. */
export const DEFAULT_MODES = { claude: 'manual', openai: 'ask' } as const satisfies Record<
  ProfileProvider,
  PermissionMode
>;

/** The modes that never ask: Skip prompts (Claude) and Full trust (Codex). */
const NO_PROMPTS: readonly PermissionMode[] = ['bypassPermissions', 'full'];

/** True when `mode` is one of the `provider` part's modes. */
export function isModeOf(provider: ProfileProvider, mode: string): mode is PermissionMode {
  return MODES[provider].some((choice) => choice.id === mode);
}

/** True when `mode` is one of the harness's modes (a turn's spec). */
export const fitsHarness = (harness: Harness, mode: string): mode is PermissionMode =>
  isModeOf(HARNESS_PROVIDER[harness], mode);

/** The mode of `provider` with this id, as the pages show it; undefined for another provider's or an unknown one. */
export function modeChoice(provider: ProfileProvider, mode: string): ModeChoice | undefined {
  return MODES[provider].find((choice) => choice.id === mode);
}

/** The old two-way setting a mode comes to, for a runner older than the modes: `bypass` when it never asks. */
export const policyOfMode = (mode: PermissionMode): PermissionPolicy =>
  NO_PROMPTS.includes(mode) ? 'bypass' : 'ask';

/** The mode the old setting means on a harness: its no-prompts mode for `bypass`, its default for `ask`. */
export function modeOfPolicy(harness: Harness, policy: PermissionPolicy): PermissionMode {
  const provider = HARNESS_PROVIDER[harness];
  if (policy === 'ask') return DEFAULT_MODES[provider];
  return provider === 'claude' ? 'bypassPermissions' : 'full';
}

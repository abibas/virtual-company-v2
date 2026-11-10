import type { ChatTurnStatus } from '@mwc/shared/enums';
import { ApiError, friendlyMessage } from '../../api/errors.ts';
import type { Tone } from '../../components/ui/Badge.tsx';

/** What the chat page says (S5.1c): the API's refusals in plain words and the turns' statuses. Pure. */

/**
 * The chat refusals the page words itself (docs/harness.md, "How a turn runs"); any other code shows the server's own
 * message, which already names what to fix (`harness_missing`, `profile_empty` name the CLI and the profile).
 */
const REFUSALS: Readonly<Record<string, string>> = {
  runner_outdated: "This machine's runner can't run chats yet: update it on the Machines page.",
  machine_offline: "The agent's machine is offline: start its runner, then try again.",
  container_runs_later:
    "The agent runs in a container, which chats don't support yet: place it on its machine, in a folder.",
  placement_missing: "The agent doesn't run anywhere yet: choose where it runs on its page first.",
  machine_changed:
    "The agent moved to another machine since this chat began, so its conversation isn't there: start a new chat.",
  harness_changed: "The agent's harness changed since this chat began: start a new chat.",
  chat_archived: 'This chat is archived: start a new chat.',
  turn_running: 'A turn is still running: wait for it, or stop it.',
  turn_not_running: 'That turn already ended.',
  credential_needs_sign_in:
    'The subscription this chat runs on needs a new sign-in: its owner signs in again on Subscriptions.',
  credential_revoked: 'The subscription this chat runs on is revoked: choose another access profile.',
  credential_not_found: 'The subscription this chat runs on is gone: choose another access profile.',
  provider_unavailable: "The provider didn't refresh the sign-in just now. Try again in a moment.",
  terminal_unavailable: "This machine's runner has no terminal: update it on the Machines page.",
  agent_archived: 'The agent is archived: restore it to chat with it.',
  forbidden: 'Only owners open the terminal, and admins and owners send messages.',
};

/** A refusal or failure of a chat call, in plain words. */
export function refusalText(error: unknown): string {
  if (error instanceof ApiError && REFUSALS[error.code]) return REFUSALS[error.code] as string;
  return friendlyMessage(error);
}

/** A turn's status chip: its tone and word. */
export const TURN_STATUS: Readonly<Record<ChatTurnStatus, { readonly tone: Tone; readonly text: string }>> = {
  queued: { tone: 'pending', text: 'Queued' },
  running: { tone: 'blue', text: 'Running' },
  done: { tone: 'done', text: 'Done' },
  failed: { tone: 'failed', text: 'Failed' },
  stopped: { tone: 'neutral', text: 'Stopped' },
};

/** The runner's and the server's reasons a turn ended without a reply, in words. */
const TURN_ERRORS: Readonly<Record<string, string>> = {
  stopped: 'Stopped before it finished.',
  machine_disconnected: 'The machine disconnected during the turn.',
  server_restarted: 'The server restarted during the turn.',
  runner_stopping: 'The runner on the machine stopped during the turn.',
  busy: 'The machine was running as many turns as it can. Try again in a moment.',
  home_missing: "The agent's folder isn't on the machine. Check where it runs.",
  unsupported: "The machine's runner can't run this harness.",
};

/** A turn's error as people read it: the known reasons in words, `spawn_failed: …` as not starting, else as it is. */
export function turnErrorText(error: string): string {
  const known = TURN_ERRORS[error];
  if (known) return known;
  if (error.startsWith('spawn_failed'))
    return `The harness didn't start (${error.replace(/^spawn_failed:?\s*/, '')}).`;
  return error;
}

/** Tokens as people read them: 1234 → "1.2k". */
export function tokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

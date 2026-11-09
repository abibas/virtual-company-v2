import type { TenantDb } from '@mwc/db';
import type { Logger } from 'pino';
import type { IssuedTicket, TerminalTickets } from '../../machines/index.ts';
import { chatsRepo } from '../repo.ts';
import { CHAT_ARCHIVED, CHAT_NOT_FOUND, type Refusal } from '../rules.ts';
import { resolveTarget, type TargetDeps } from './target.ts';

/**
 * A chat's terminal (S5.1b): the harness's own TUI on the chat's conversation, in the agent's folder on its machine, for
 * an owner. The ticket is the machine terminal's (`/api/terminal/ws`, one use within 60 s), issued once the chat's
 * target resolved (the same refusals as a turn, and `terminal_unavailable` without a PTY); it holds the spec with its
 * credential in this process's memory until it is used, and the browser's socket then opens the TUI instead of a shell.
 * A Codex login the TUI rewrote comes back with its end and is sealed again.
 */

export interface ChatTerminalDeps extends TargetDeps {
  readonly tickets: TerminalTickets;
  readonly logger: Logger;
}

/** The owner asking: their person and principal. */
export interface TerminalCaller {
  readonly userId: string;
  readonly principalId: string;
}

/** A ticket for the chat's terminal, or why not. */
export async function chatTerminalTicket(
  deps: ChatTerminalDeps,
  t: TenantDb,
  caller: TerminalCaller,
  chatId: string,
  now: Date,
): Promise<{ readonly ok: true; readonly ticket: IssuedTicket } | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (chat.archivedAt !== null) return CHAT_ARCHIVED;
  const target = await resolveTarget(deps, t, chat, {
    principalId: caller.principalId,
    purpose: 'chat_terminal',
  });
  if (!target.ok) return target;
  const { credentialId, ownerUserId, kind } = target;
  const rewrote = (authJson: string) => {
    if (kind !== 'codex_oauth') return;
    deps.credentials
      .rewriteCodexLogin(credentialId, ownerUserId, authJson, 'chat_terminal')
      .catch((error: unknown) => {
        deps.logger.error({ err: error, credentialId }, 'chats: could not seal a login a terminal rewrote');
      });
  };
  const binding = {
    ...caller,
    companyId: t.companyId,
    machineId: chat.machineId,
    harness: target.spec,
    rewrote,
  };
  return { ok: true, ticket: deps.tickets.issue(binding, now) };
}

import { type ChatTurn, isUniqueViolation, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import type { ChatBus } from './bus.ts';
import { turnView } from './views.ts';

/**
 * The turns of a chat that run no process (2026-11-14, docs/harness.md "Who is in a chat"): a quiet line saying who
 * joined or left (`people`), and a message its Slack connection's owner sent straight into the Slack conversation
 * (`slack`, with its address there). Each is numbered after the chat's last turn, done at once, on no credential, and
 * told to the chat's stream; a message sent in Slack moves the chat up its lists as any message does.
 */

export interface NoteDeps {
  readonly bus: Pick<ChatBus, 'publish'>;
  readonly clock: () => Date;
}

/** What the turn says, and who it is by. */
export interface Note {
  readonly kind: 'people' | 'slack';
  readonly prompt: string;
  readonly by: string;
  readonly replyLink?: string | null;
}

/** The tries a note makes when a turn of the chat took its number meanwhile. */
const TRIES = 3;

/** Records the note after the chat's last turn and tells the stream (see above). */
export async function recordNote(deps: NoteDeps, t: TenantDb, chatId: string, note: Note): Promise<ChatTurn> {
  for (let attempt = 1; ; attempt++) {
    try {
      const turn = await t.transaction(async (tx) => {
        const now = deps.clock();
        const seq = (await turnsRepo.lastSeq(tx, chatId)) + 1;
        const row = await turnsRepo.insert(tx, {
          id: newId(),
          chatId,
          seq,
          kind: note.kind,
          prompt: note.prompt,
          status: 'done',
          endedAt: now,
          replyLink: note.replyLink ?? null,
          createdBy: note.by,
        });
        if (note.kind === 'slack') await chatsRepo.update(tx, chatId, { updatedAt: now });
        return row;
      });
      deps.bus.publish(chatId, { kind: 'turn', turn: turnView(turn) });
      return turn;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= TRIES) throw error;
    }
  }
}

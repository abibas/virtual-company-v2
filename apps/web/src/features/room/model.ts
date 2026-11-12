import type { RoomMember, RoomMessage } from '../../api/room.ts';
import type { ChartNode } from '../../api/types.ts';
import { type MessageAuthorView, SYSTEM_AUTHOR } from '../../components/feed/MessageAuthor.tsx';
import { nodeAuthor, type Prompter, type Reader } from '../chats/thread/authors.ts';

/**
 * The team room's pure parts (docs/processes.md "The team room"): who wrote a message (a person's avatar, an agent's
 * icon, Most Wanted's mark), whether it is the reader's own, and the "@" the composer is completing with the agents it
 * offers.
 */

/** The author of a message from the chart (`nodes`, by principal), else by the name the room gives. */
export function roomAuthor(
  author: RoomMessage['author'],
  nodes: ReadonlyMap<string, ChartNode> | undefined,
  reader: Pick<Reader, 'id'> | undefined,
): Prompter {
  if (author === null) return { author: SYSTEM_AUTHOR, own: false };
  const node = nodes?.get(author.principalId);
  if (node !== undefined) {
    const own = node.kind === 'person' && node.person.userId === reader?.id;
    return { author: nodeAuthor(node), own };
  }
  const named: MessageAuthorView =
    author.kind === 'agent'
      ? { kind: 'agent', name: author.name, agent: { name: author.name } }
      : { kind: 'person', name: author.name };
  return { author: named, own: false };
}

/** A member of the room as a face: from the chart, else by its name. */
export const memberAuthor = (member: RoomMember, nodes: ReadonlyMap<string, ChartNode> | undefined) =>
  roomAuthor(member, nodes, undefined).author;

/** The "@" being typed at the caret: where it starts and what follows it; none outside one. */
export interface MentionDraft {
  readonly start: number;
  readonly query: string;
}

/** The "@" the caret is in: after a space or the start, with no line break up to the caret (at most 40 characters). */
export function mentionAt(text: string, caret: number): MentionDraft | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s|\(/.test(before.charAt(at - 1)))) return undefined;
  const query = before.slice(at + 1);
  if (query.length > 40 || /\n/.test(query)) return undefined;
  return { start: at, query };
}

/** The agents an "@" may name: those whose name or slug starts with what was typed (any case). */
export function mentionChoices(agents: readonly RoomMember[], query: string): RoomMember[] {
  const typed = query.toLowerCase();
  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().startsWith(typed) || (agent.slug ?? '').toLowerCase().startsWith(typed),
  );
}

/** The text with the "@" at `draft` completed to the agent's name and a space; and where the caret goes. */
export function completeMention(text: string, caret: number, draft: MentionDraft, agent: RoomMember) {
  const inserted = `@${agent.name} `;
  const next = `${text.slice(0, draft.start)}${inserted}${text.slice(caret)}`;
  return { text: next, caret: draft.start + inserted.length };
}

/** A notice's first line (its headline), and whether more follows it. */
export function headline(body: string): { readonly first: string; readonly more: boolean } {
  const [first = '', ...rest] = body.split('\n');
  return { first, more: rest.some((line) => line.trim() !== '') };
}

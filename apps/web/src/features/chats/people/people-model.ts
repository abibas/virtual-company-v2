import type { ChartNode, ChatPerson } from '../../../api/types.ts';
import { personName } from '../../../components/ui/Avatar.tsx';

/**
 * Who may be in a chat, from the company's chart (2026-11-14, docs/harness.md "Who is in a chat"): its people above a
 * viewer (viewers read no chats), by name; the reader's own place; and what the reader may do with each person in the
 * chat (leave themselves; take someone else out as the chat's creator or a company owner).
 */

/** A member who can be put in a chat. */
export interface MemberChoice {
  readonly principalId: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

type PersonNode = Extract<ChartNode, { kind: 'person' }>;

const isPerson = (node: ChartNode): node is PersonNode => node.kind === 'person';

/** The chart's people who may be in a chat, but those named, by name. */
export function memberChoices(nodes: readonly ChartNode[], leaveOut: ReadonlySet<string>): MemberChoice[] {
  return nodes
    .filter(isPerson)
    .filter((node) => node.person.role !== 'viewer' && !leaveOut.has(node.principalId))
    .map((node) => ({
      principalId: node.principalId,
      name: personName(node.person.displayName, node.person.email),
      imageUrl: node.person.imageUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The reader's principal on the chart; undefined while it loads. */
export function readerPrincipal(nodes: readonly ChartNode[] | undefined, userId: string): string | undefined {
  return nodes?.find((node) => isPerson(node) && node.person.userId === userId)?.principalId;
}

/** What the reader may do with a person in the chat: leave (themselves), take out, or nothing. */
export function removalOf(
  person: Pick<ChatPerson, 'principalId'>,
  reader: { readonly principalId: string | undefined; readonly creator: boolean; readonly owner: boolean },
): 'leave' | 'remove' | null {
  if (person.principalId !== null && person.principalId === reader.principalId) return 'leave';
  return reader.creator || reader.owner ? 'remove' : null;
}

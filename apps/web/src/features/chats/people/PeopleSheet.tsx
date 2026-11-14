import { LogOut, UserMinus } from 'lucide-react';
import { useMemo } from 'react';
import type { ChartNode, ChatPerson } from '../../../api/types.ts';
import { Avatar } from '../../../components/ui/Avatar.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { SlackMark } from '../../../components/ui/ProviderLogo.tsx';
import { useAction } from '../use-action.ts';
import { MemberPicker } from './MemberPicker.tsx';
import { memberChoices, removalOf } from './people-model.ts';

/**
 * People in this chat (2026-11-14, docs/harness.md "Who is in a chat"): who is in it with their faces (a contact with
 * the Slack mark), Remove for the chat's creator and company owners, Leave for yourself, and Add person for anyone in
 * it (an owner who only looks on adds themselves instead: Add me). Each change shows as a quiet line in the thread.
 */

export interface PeopleActions {
  readonly add: (principalIds: readonly string[]) => Promise<void>;
  readonly remove: (personId: string) => Promise<void>;
}

/** One person in the chat, with what the reader may do to them. */
function PersonRow({
  person,
  removal,
  onRemove,
}: {
  readonly person: ChatPerson;
  readonly removal: 'leave' | 'remove' | null;
  readonly onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
      <Avatar name={person.name} src={person.imageUrl} size="sm" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-medium text-ink">{person.name}</span>
        <span className="text-2xs text-dim">
          {person.kind === 'contact' ? 'Contact' : person.creator ? 'Began this chat' : 'Member'}
        </span>
      </span>
      {person.kind === 'contact' && (
        <Badge size="sm" icon={SlackMark}>
          Slack
        </Badge>
      )}
      {removal && (
        <Button size="sm" tone="quiet" icon={removal === 'leave' ? LogOut : UserMinus} onClick={onRemove}>
          {removal === 'leave' ? 'Leave' : 'Remove'}
        </Button>
      )}
    </li>
  );
}

export function PeopleSheet({
  people,
  nodes,
  reader,
  looksOn,
  actions,
}: {
  readonly people: readonly ChatPerson[];
  /** The company's chart, for the members to add; undefined while it loads. */
  readonly nodes: readonly ChartNode[] | undefined;
  readonly reader: { readonly principalId: string | undefined; readonly owner: boolean };
  /** The reader is an owner who is not in the chat. */
  readonly looksOn: boolean;
  readonly actions: PeopleActions;
}) {
  const { busy, error, run } = useAction();
  const creator = people.some((p) => p.creator && p.principalId === reader.principalId);
  const choices = useMemo(
    () => memberChoices(nodes ?? [], new Set(people.flatMap((p) => p.principalId ?? []))),
    [nodes, people],
  );
  const who = { ...reader, creator };
  return (
    <div className="grid gap-5">
      {error && (
        <p role="alert" className="text-sm font-medium text-failed">
          {error}
        </p>
      )}
      <ul className="-mx-2 grid gap-0.5">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            removal={looksOn ? null : removalOf(person, who)}
            onRemove={() => void run(() => actions.remove(person.id))}
          />
        ))}
      </ul>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold text-dim">{looksOn ? 'Join this chat' : 'Add person'}</h3>
        {looksOn ? (
          <Button
            tone="primary"
            size="sm"
            busy={busy}
            disabled={reader.principalId === undefined}
            onClick={() => void run(() => actions.add([reader.principalId as string]))}
          >
            Add me
          </Button>
        ) : nodes === undefined ? (
          <p className="text-sm text-dim">Loading the members…</p>
        ) : (
          <MemberPicker
            choices={choices}
            action="Add"
            busy={busy}
            onPick={(ids) => void run(() => actions.add(ids))}
          />
        )}
      </section>
    </div>
  );
}

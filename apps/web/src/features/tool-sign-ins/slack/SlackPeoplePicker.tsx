import { SLACK_PEOPLE_MAX } from '@mwc/shared/credentials';
import { X } from 'lucide-react';
import type { SlackPerson } from '../../../api/slack-inbound.ts';
import { Avatar } from '../../../components/ui/Avatar.tsx';
import { SlackPeopleSearch } from './SlackPeopleSearch.tsx';

/** One person as a chip: their avatar and name, and a remove button. */
function PersonChip({ person, remove }: { readonly person: SlackPerson; readonly remove: () => void }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-1 pl-0.5 text-xs font-semibold text-ink-2">
      <Avatar name={person.name} src={person.image} size="xs" />
      {person.name}
      <button
        type="button"
        aria-label={`Remove ${person.name}`}
        onClick={remove}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-dim hover:bg-surface-3 hover:text-ink"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * The people who may wake agents: chips with their avatars, and a search of the workspace by name or email whose
 * matches add a person (`SlackPeopleSearch`).
 */
export function SlackPeoplePicker({
  credentialId,
  people,
  onChange,
}: {
  readonly credentialId: string;
  readonly people: readonly SlackPerson[];
  readonly onChange: (people: SlackPerson[]) => void;
}) {
  const listed = new Set(people.map((person) => person.id));
  const full = people.length >= SLACK_PEOPLE_MAX;
  return (
    <div className="flex flex-col gap-2">
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="People who may wake agents">
          {people.map((person) => (
            <PersonChip
              key={person.id}
              person={person}
              remove={() => onChange(people.filter((one) => one.id !== person.id))}
            />
          ))}
        </ul>
      )}
      {!full && (
        <SlackPeopleSearch
          credentialId={credentialId}
          listed={listed}
          add={({ id, name, image }) => onChange([...people, { id, name, image }])}
        />
      )}
    </div>
  );
}

import { SLACK_PEOPLE_MAX } from '@mwc/shared/credentials';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../../api/context.ts';
import { friendlyMessage } from '../../../api/errors.ts';
import { type SlackPerson, slackInboundCalls } from '../../../api/slack-inbound.ts';
import { Input } from '../../../components/forms/Input.tsx';
import { Avatar } from '../../../components/ui/Avatar.tsx';

/** How long the search waits after the last key before asking Slack. */
const SEARCH_DELAY_MS = 300;

/** The workspace's people matching the words, asked a moment after the last key. */
function useSearch(credentialId: string, words: string) {
  const api = useApi();
  const calls = useMemo(() => slackInboundCalls(api), [api]);
  const [found, setFound] = useState<readonly SlackPerson[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const q = words.trim();
    if (q === '') {
      setFound([]);
      setError(undefined);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      calls.people(credentialId, q).then(
        (answer) => {
          if (current) setFound(answer.people);
          if (current) setError(undefined);
        },
        (failure: unknown) => {
          if (current) setError(friendlyMessage(failure));
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [calls, credentialId, words]);
  return { found, error };
}

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
 * results add a person on click.
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
  const [words, setWords] = useState('');
  const { found, error } = useSearch(credentialId, words);
  const listed = new Set(people.map((person) => person.id));
  const choices = found.filter((person) => !listed.has(person.id));
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
        <Input
          size="sm"
          type="search"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          placeholder="Add a person: name or email"
          aria-label="Search Slack people"
        />
      )}
      {error && <p className="text-xs text-blocked">{error}</p>}
      {choices.length > 0 && (
        <ul
          className="flex flex-col rounded-md border border-line bg-surface"
          aria-label="Slack people found"
        >
          {choices.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...people, person]);
                  setWords('');
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-sm text-ink hover:bg-surface-2"
              >
                <Avatar name={person.name} src={person.image} size="xs" />
                {person.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

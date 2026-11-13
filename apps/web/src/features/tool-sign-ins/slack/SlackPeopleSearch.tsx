import { type KeyboardEvent, useId, useState } from 'react';
import { type SlackFound, useSlackPeopleSearch } from '../../../api/slack-inbound.ts';
import { cx } from '../../../components/cx.ts';
import { Input } from '../../../components/forms/Input.tsx';
import { Avatar } from '../../../components/ui/Avatar.tsx';
import { Spinner } from '../../../components/ui/Button.tsx';
import { Highlighted } from './Highlighted.tsx';

/** A thin bar sliding while the workspace's people load, with how many are in so far. */
function LoadingBar({ loaded }: { readonly loaded: number }) {
  return (
    <div className="flex flex-col gap-1" role="status">
      <div className="h-0.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full w-2/5 rounded-full bg-blue motion-safe:animate-indeterminate" />
      </div>
      <p className="text-2xs text-dim">Loading people… {loaded.toLocaleString('en-US')}</p>
    </div>
  );
}

/** One person found: avatar, name, title and email, the typed part marked. */
function FoundRow({
  person,
  query,
  active,
  id,
  pick,
  hover,
}: {
  readonly person: SlackFound;
  readonly query: string;
  readonly active: boolean;
  readonly id: string;
  readonly pick: () => void;
  readonly hover: () => void;
}) {
  const detail = [person.title, person.email].filter(Boolean);
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onClick={pick}
      onMouseEnter={hover}
      className={cx(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
        active ? 'bg-surface-2' : 'hover:bg-surface-2',
      )}
    >
      <Avatar name={person.name} src={person.image} size="xs-sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-ink">
          <Highlighted text={person.name} query={query} />
        </span>
        {detail.length > 0 && (
          <span className="truncate text-2xs text-dim">
            {person.title}
            {person.title && person.email && ' · '}
            {person.email && <Highlighted text={person.email} query={query} />}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The field that adds a person: focusing it warms the server's directory of the workspace (a sliding bar while it
 * loads), typing lists the matches right under it (↑/↓ to move, Enter adds, Esc closes), people already listed hidden.
 */
export function SlackPeopleSearch({
  credentialId,
  listed,
  add,
}: {
  readonly credentialId: string;
  readonly listed: ReadonlySet<string>;
  readonly add: (person: SlackFound) => void;
}) {
  const [words, setWords] = useState('');
  const [warm, setWarm] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { searched, busy, error, reload } = useSlackPeopleSearch(credentialId, words, warm);
  const listId = useId();
  const query = words.trim();
  const answer = searched?.answer;
  const current = searched !== undefined && searched.q === query;
  // The last answer stays until the next one is in, so the list does not flash between keys.
  const people = query !== '' ? (answer?.people ?? []) : [];
  const choices = people.filter((person) => !listed.has(person.id));
  const none = current && query !== '' && answer?.loading === false && choices.length === 0;
  const shown = open && query !== '' && (choices.length > 0 || none);
  const at = Math.min(active, Math.max(choices.length - 1, 0));

  const pick = (person: SlackFound) => {
    add(person);
    setWords('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (!shown) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (choices.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at + step + choices.length) % choices.length);
    } else if (event.key === 'Enter') {
      const person = choices[at];
      if (!shown || person === undefined) return;
      event.preventDefault();
      pick(person);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Input
          size="sm"
          value={words}
          onChange={(event) => {
            setWords(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setWarm(true);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Add a person: name or email"
          aria-label="Search Slack people"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && choices.length > 0 ? `${listId}-${at}` : undefined}
          className="pr-8"
        />
        {busy && <Spinner size={14} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-dim" />}
        {shown && (
          <div
            id={listId}
            role="listbox"
            aria-label="Slack people found"
            className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-lg bg-surface p-1 shadow-float ring-1 ring-line"
          >
            {choices.map((person, index) => (
              <FoundRow
                key={person.id}
                person={person}
                query={query}
                active={index === at}
                id={`${listId}-${index}`}
                pick={() => pick(person)}
                hover={() => setActive(index)}
              />
            ))}
            {none && (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-dim">
                No one matches
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={reload}
                  className="cursor-pointer text-xs font-semibold text-blue hover:underline"
                >
                  Reload from Slack
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {answer?.loading && <LoadingBar loaded={answer.loaded} />}
      {error && <p className="text-xs text-blocked">{error}</p>}
    </div>
  );
}

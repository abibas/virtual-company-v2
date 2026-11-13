import { ACCESS_PROFILE_NAME } from '@mwc/shared/credentials';
import { type ReactNode, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfile, AccessProfileChanges, Subscription } from '../../api/types.ts';
import { Link } from '../../app/router.tsx';
import { count } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { SelectField } from '../../components/forms/Field.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import type { SelectOption } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import type { IconComponent } from '../../components/ui/icon.ts';
import { companyAgentLinks } from '../agents/links.ts';

/** What a profile's card is given: the profile, the person's credentials, and its change and removal. */
export interface CardProps {
  readonly profile: AccessProfile;
  readonly subscriptions: readonly Subscription[];
  /** Changes the profile (`PATCH`), then the list is read again. */
  readonly update: (changes: AccessProfileChanges) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
}

/** A part's section on the card: its logo and name, Remove, and its fields under them. */
export function PartFrame({
  name,
  icon: Icon,
  onRemove,
  children,
}: {
  readonly name: string;
  readonly icon: IconComponent;
  readonly onRemove: () => Promise<unknown>;
  readonly children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onRemove();
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <section aria-label={name} className="flex flex-col gap-3 rounded-xl border border-line px-3 py-2.5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon size={16} aria-hidden="true" />
          {name}
        </span>
        <span className="flex items-center gap-2">
          {error && (
            <span role="alert" className="text-xs font-medium text-failed">
              {error}
            </span>
          )}
          <Button size="sm" tone="quiet" busy={busy} onClick={() => void remove()}>
            Remove
          </Button>
        </span>
      </header>
      {children}
    </section>
  );
}

/** A select of the profile's that saves as soon as it changes; a refusal shows under it. */
export function SavedSelect({
  label,
  hint,
  value,
  options,
  save,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly save: (value: string | null) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = async (next: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await save(next || null);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SelectField
      label={label}
      hint={hint}
      error={error}
      value={value}
      disabled={busy}
      options={options}
      onChange={(event) => void change(event.target.value)}
    />
  );
}

/** A card's top: the profile's name (renamed in place), and Delete, confirmed in place. */
export function ProfileHeader({ profile, update, remove }: Omit<CardProps, 'subscriptions'>) {
  const users = profile.agents.length;
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <InlineEdit
          value={profile.name}
          label={`Rename ${profile.name}`}
          maxLength={ACCESS_PROFILE_NAME.max}
          onSave={(name) => update({ name })}
        >
          <span className="text-md font-bold tracking-[-0.01em] text-ink">{profile.name}</span>
        </InlineEdit>
      </div>
      <ConfirmInline
        label="Delete"
        question={
          users > 0
            ? `Delete ${profile.name}? ${count(users, 'agent')} using it lose it.`
            : `Delete ${profile.name}?`
        }
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </header>
  );
}

/** "Used by: Developer, QA": the agents that use the profile, each a link to its page in its company; nothing when none does. */
export function ProfileAgents({ agents }: { readonly agents: AccessProfile['agents'] }) {
  if (agents.length === 0) return null;
  return (
    <p className="text-xs text-dim">
      Used by:{' '}
      {agents.map((agent, index) => (
        <span key={agent.agentId}>
          {index > 0 && ', '}
          <Link
            to={companyAgentLinks(agent.companySlug).agent({ slug: agent.agentSlug, id: agent.agentId })}
            title={agent.companyName}
            className="font-semibold text-ink-2 hover:text-teal focus-visible:text-teal"
          >
            {agent.agentName}
          </Link>
        </span>
      ))}
    </p>
  );
}

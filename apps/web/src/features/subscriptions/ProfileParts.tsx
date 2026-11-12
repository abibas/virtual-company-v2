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
import { companyAgentLinks } from '../agents/links.ts';
import { ProviderBadge } from './Providers.tsx';

/** What a profile's card is given: the profile, the person's credentials, and its change and removal. */
export interface CardProps {
  readonly profile: AccessProfile;
  readonly subscriptions: readonly Subscription[];
  /** Changes the profile (`PATCH`), then the list is read again. */
  readonly update: (changes: AccessProfileChanges) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
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

/** A card's top: the profile's name (renamed in place) with its provider's badge, and Delete, confirmed in place. */
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
        <ProviderBadge provider={profile.provider} />
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

/** The agents that use the profile, each a link to its page in its company; `none` (or nothing) when none does. */
export function ProfileAgents({
  agents,
  none,
}: {
  readonly agents: AccessProfile['agents'];
  readonly none?: string;
}) {
  if (agents.length === 0) return none ? <p className="text-xs text-dim">{none}</p> : null;
  return (
    <div>
      <p className="text-xs font-semibold text-dim">Used by {count(agents.length, 'agent')}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {agents.map((agent) => (
          <li key={agent.agentId}>
            <Link
              to={companyAgentLinks(agent.companySlug).agent({ slug: agent.agentSlug, id: agent.agentId })}
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 hover:text-teal focus-visible:text-teal"
            >
              <span className="font-medium text-dim">{agent.companyName} /</span>
              {agent.agentName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

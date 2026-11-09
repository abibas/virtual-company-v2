import {
  ACCESS_PROFILE_NAME,
  fitsSlot,
  PROFILE_SLOT_KINDS,
  PROFILE_SLOTS,
  type ProfileSlot,
} from '@mwc/shared/credentials';
import { type FormEvent, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfile, AccessProfileChanges, Subscription } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { count } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { SelectField, TextField } from '../../components/forms/Field.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import type { SelectOption } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { companyAgentLinks } from '../agents/links.ts';
import { kindLabel } from './KindBadge.tsx';

/** The card of a profile being made: its name, then its slots on its own card. */
export function NewProfileForm({
  create,
  onCancel,
}: {
  /** Creates it (`POST`) and closes this card; a refusal (a name taken) shows here. */
  readonly create: (name: string) => Promise<unknown>;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await create(name.trim());
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <Card as="section" aria-label="New profile" className="mb-4">
      <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-start gap-3">
        <TextField
          label="Name of the new profile"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoFocus
          maxLength={ACCESS_PROFILE_NAME.max}
          placeholder="Work"
          hint="Choose its subscriptions on its card next."
          error={error}
          className="min-w-56 flex-1"
        />
        <div className="flex gap-2 sm:pt-7">
          <Button tone="quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" busy={busy} disabled={name.trim() === ''}>
            Create profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Each slot's name and what it is for. */
const SLOTS: Readonly<Record<ProfileSlot, { readonly label: string; readonly hint: string }>> = {
  claude: { label: 'Claude', hint: 'For Claude Code agents' },
  openai: { label: 'OpenAI', hint: 'For Codex agents' },
  gateway: { label: 'Gateway', hint: 'Where runs send their AI requests' },
};

/** A slot's change as `PATCH /api/me/access-profiles/:id` takes it (null empties it). */
function changeOf(slot: ProfileSlot, credentialId: string | null): AccessProfileChanges {
  if (slot === 'claude') return { claudeCredentialId: credentialId };
  if (slot === 'openai') return { openaiCredentialId: credentialId };
  return { gatewayCredentialId: credentialId };
}

type SlotValue = AccessProfile[ProfileSlot];

/** None, then your subscriptions of the kinds the slot takes, by kind; a revoked one only while it is in the slot. */
function slotOptions(slot: ProfileSlot, subscriptions: readonly Subscription[], current: SlotValue) {
  const kinds: readonly string[] = PROFILE_SLOT_KINDS[slot];
  const fitting = subscriptions
    .filter((s) => fitsSlot(slot, s.kind) && (s.status !== 'revoked' || s.id === current?.id))
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  const choices = current && !fitting.some((s) => s.id === current.id) ? [current, ...fitting] : fitting;
  return [
    { value: '', label: 'None' },
    ...choices.map(
      (s): SelectOption => ({
        value: s.id,
        label: s.status === 'revoked' ? `${s.label} (revoked)` : s.label,
        group: kindLabel(s.kind),
      }),
    ),
  ];
}

interface CardProps {
  readonly profile: AccessProfile;
  readonly subscriptions: readonly Subscription[];
  /** Changes the profile (`PATCH`), then the list is read again. */
  readonly update: (changes: AccessProfileChanges) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
}

/** One slot: a select of your fitting subscriptions with None, saved as soon as it changes. */
function SlotSelect({
  slot,
  profile,
  subscriptions,
  update,
}: Omit<CardProps, 'remove'> & { readonly slot: ProfileSlot }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = profile[slot];
  const addGatewayHref = usePersonalHref('gateways', true);
  const change = async (value: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await update(changeOf(slot, value || null));
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const noGateway =
    slot === 'gateway' && !subscriptions.some((s) => s.kind === 'gateway' && s.status !== 'revoked');
  return (
    <SelectField
      label={SLOTS[slot].label}
      hint={
        noGateway ? (
          <>
            You have none yet.{' '}
            <Link to={addGatewayHref} className="font-semibold text-blue hover:underline">
              Add a gateway
            </Link>
          </>
        ) : (
          SLOTS[slot].hint
        )
      }
      error={error}
      value={current?.id ?? ''}
      disabled={busy}
      options={slotOptions(slot, subscriptions, current)}
      onChange={(event) => void change(event.target.value)}
    />
  );
}

/** The agents that use the profile, each a link to its page in its company. */
function ProfileAgents({ agents }: { readonly agents: AccessProfile['agents'] }) {
  if (agents.length === 0) {
    return (
      <p className="text-xs text-dim">
        No agent uses it yet. Give it to an agent on the agent’s page, in a company where you are an admin.
      </p>
    );
  }
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

/**
 * One access profile: its name (renamed in place), its three slots, the agents that use it, and Delete, confirmed in
 * place. A change saves at once.
 */
export function ProfileCard({ profile, subscriptions, update, remove }: CardProps) {
  const users = profile.agents.length;
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <InlineEdit
          value={profile.name}
          label={`Rename ${profile.name}`}
          maxLength={ACCESS_PROFILE_NAME.max}
          onSave={(name) => update({ name })}
        >
          <span className="text-md font-bold tracking-[-0.01em] text-ink">{profile.name}</span>
        </InlineEdit>
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
      <div className="grid gap-4 sm:grid-cols-3">
        {PROFILE_SLOTS.map((slot) => (
          <SlotSelect
            key={slot}
            slot={slot}
            profile={profile}
            subscriptions={subscriptions}
            update={update}
          />
        ))}
      </div>
      <ProfileAgents agents={profile.agents} />
    </Card>
  );
}

import { ACCESS_PROFILE_NAME } from '@mwc/shared/credentials';
import { type ReactNode, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfile, AccessProfileChanges, Subscription } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { count } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { SelectField } from '../../components/forms/Field.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import type { SelectOption } from '../../components/forms/Input.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { companyAgentLinks } from '../agents/links.ts';
import { PROVIDER_STYLES, ProviderBadge } from './Providers.tsx';
import { gatewayOptions, hasGateway, subscriptionOptions } from './profile-options.ts';
import { RunsFields } from './RunsFields.tsx';

interface CardProps {
  readonly profile: AccessProfile;
  readonly subscriptions: readonly Subscription[];
  /** Changes the profile (`PATCH`), then the list is read again. */
  readonly update: (changes: AccessProfileChanges) => Promise<unknown>;
  /** Removes it (`DELETE`), then the list is read again. */
  readonly remove: () => Promise<void>;
}

/** A select of the profile's that saves as soon as it changes; a refusal shows under it. */
function SavedSelect({
  label,
  hint,
  value,
  options,
  save,
}: {
  readonly label: string;
  readonly hint: ReactNode;
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

/** The profile's gateway: any of the person's gateways (they serve Claude Code and Codex alike), or where to add one. */
function GatewaySlot({ profile, subscriptions, update }: Omit<CardProps, 'remove'>) {
  const addGatewayHref = usePersonalHref('gateways', true);
  return (
    <SavedSelect
      label="Gateway"
      hint={
        hasGateway(subscriptions) || profile.gateway ? (
          'Where its runs send their AI requests'
        ) : (
          <>
            You have none yet.{' '}
            <Link to={addGatewayHref} className="font-semibold text-blue hover:underline">
              Add a gateway
            </Link>
          </>
        )
      }
      value={profile.gateway?.id ?? ''}
      options={gatewayOptions(subscriptions, profile.gateway)}
      save={(gatewayCredentialId) => update({ gatewayCredentialId })}
    />
  );
}

/** The profile's subscription (of its provider) and gateway (any). */
function ProfileCredentials({ profile, subscriptions, update }: Omit<CardProps, 'remove'>) {
  const style = PROVIDER_STYLES[profile.provider];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SavedSelect
        label="Subscription"
        hint={
          profile.subscription === null
            ? `Its ${style.agents} cannot run until you choose one`
            : `What its ${style.agents} run on`
        }
        value={profile.subscription?.id ?? ''}
        options={subscriptionOptions(profile.provider, subscriptions, profile.subscription)}
        save={(credentialId) => update({ credentialId })}
      />
      <GatewaySlot profile={profile} subscriptions={subscriptions} update={update} />
    </div>
  );
}

/** What the profile's runs use: its model and effort, of its provider, each saved as soon as it changes. */
function ProfileRuns({ profile, update }: Pick<CardProps, 'profile' | 'update'>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <RunsFields
        provider={profile.provider}
        runs={{ model: profile.model, effort: profile.effort }}
        onChange={(change) => update(change)}
      />
    </div>
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
 * One access profile: its name (renamed in place) with its provider's badge, its subscription and gateway, the model
 * and effort its runs use, the agents that use it, and Delete, confirmed in place. A change saves at once.
 */
export function ProfileCard({ profile, subscriptions, update, remove }: CardProps) {
  const users = profile.agents.length;
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
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
      <ProfileCredentials profile={profile} subscriptions={subscriptions} update={update} />
      <ProfileRuns key={profile.id} profile={profile} update={update} />
      <ProfileAgents agents={profile.agents} />
    </Card>
  );
}

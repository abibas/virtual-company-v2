import { TOOL_PROVIDERS } from '@mwc/shared/credentials';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { type CardProps, ProfileAgents, ProfileHeader, SavedSelect } from './ProfileParts.tsx';
import { gatewayOptions, hasGateway, subscriptionOptions } from './profile-options.ts';
import { RunsFields } from './RunsFields.tsx';
import { ToolPartSection } from './ToolPartSection.tsx';

/** The profile's gateway: any of the person's gateways (they serve Claude Code and Codex alike), or where to add one. */
function GatewaySlot({ profile, subscriptions, update }: Omit<CardProps, 'remove'>) {
  const addGatewayHref = usePersonalHref('gateways', true);
  return (
    <SavedSelect
      label="Gateway"
      hint={
        !hasGateway(subscriptions) &&
        !profile.gateway && (
          <Link to={addGatewayHref} className="font-semibold text-blue hover:underline">
            Add a gateway
          </Link>
        )
      }
      value={profile.gateway?.id ?? ''}
      options={gatewayOptions(subscriptions, profile.gateway)}
      save={(gatewayCredentialId) => update({ gatewayCredentialId })}
    />
  );
}

/** The profile's AI part: its subscription (of its provider), gateway (any), model and effort, each saved at once. */
function AiPart({ profile, subscriptions, update }: Omit<CardProps, 'remove'>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SavedSelect
        label="Subscription"
        hint={profile.subscription === null ? 'Its agents cannot run without one' : undefined}
        value={profile.subscription?.id ?? ''}
        options={subscriptionOptions(profile.provider, subscriptions, profile.subscription)}
        save={(credentialId) => update({ credentialId })}
      />
      <GatewaySlot profile={profile} subscriptions={subscriptions} update={update} />
      <RunsFields
        key={profile.id}
        provider={profile.provider}
        runs={{ model: profile.model, effort: profile.effort }}
        onChange={(change) => update(change)}
      />
    </div>
  );
}

/**
 * One access profile (S7.1b, one profile with tool parts since 2026-11-13): its name (renamed in place) with its
 * provider's badge and Delete; its AI part (subscription, gateway, model, effort); its GitHub and Atlassian parts; and
 * which agents use it. A change saves at once.
 */
export function ProfileCard({ profile, subscriptions, update, remove }: CardProps) {
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
      <ProfileHeader profile={profile} update={update} remove={remove} />
      <AiPart profile={profile} subscriptions={subscriptions} update={update} />
      {TOOL_PROVIDERS.map((tool) => (
        <ToolPartSection
          key={tool}
          tool={tool}
          profile={profile}
          subscriptions={subscriptions}
          update={update}
        />
      ))}
      <ProfileAgents agents={profile.agents} />
    </Card>
  );
}

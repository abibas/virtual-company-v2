import { isAiProvider } from '@mwc/shared/credentials';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { type CardProps, ProfileAgents, ProfileHeader, SavedSelect } from './ProfileParts.tsx';
import { PROVIDER_STYLES } from './Providers.tsx';
import { gatewayOptions, hasGateway, subscriptionOptions } from './profile-options.ts';
import { RunsFields } from './RunsFields.tsx';

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
  if (!isAiProvider(profile.provider)) return null;
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

/**
 * One AI access profile (a Claude or an OpenAI one; tool profiles are `ToolProfileCard`'s): its name (renamed in place)
 * with its provider's badge, its subscription and gateway, the model and effort its runs use, the agents that use it,
 * and Delete, confirmed in place. A change saves at once.
 */
export function ProfileCard({ profile, subscriptions, update, remove }: CardProps) {
  return (
    <Card as="article" aria-label={profile.name} className="flex flex-col gap-4">
      <ProfileHeader profile={profile} update={update} remove={remove} />
      <ProfileCredentials profile={profile} subscriptions={subscriptions} update={update} />
      <ProfileRuns key={profile.id} profile={profile} update={update} />
      <ProfileAgents
        agents={profile.agents}
        none="No agent uses it yet. Give it to an agent on the agent’s page, in a company where you are an admin."
      />
    </Card>
  );
}

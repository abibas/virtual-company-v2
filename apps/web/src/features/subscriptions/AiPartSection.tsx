import type { ProfileProvider } from '@mwc/shared/enums';
import type { AccessProfileChanges } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { ModeField } from './ModeField.tsx';
import { type CardProps, PartFrame, SavedSelect } from './ProfileParts.tsx';
import { PART_STYLES } from './Providers.tsx';
import { gatewayOptions, hasGateway, subscriptionOptions } from './profile-options.ts';
import { RunsFields } from './RunsFields.tsx';

type Part = NonNullable<CardProps['profile']['parts'][ProfileProvider]>;

/** A change of one AI part, as `PATCH` takes it: what it gives, or null to remove the part. */
export const aiPartChange = (
  provider: ProfileProvider,
  part: Record<string, unknown> | null,
): AccessProfileChanges => ({ parts: { [provider]: part } }) as AccessProfileChanges;

/**
 * A profile's Claude or OpenAI part on its card (generic profiles since 2026-11-13): its subscription (of that
 * provider), its gateway (any), its model, effort and mode, each saved as it changes, and Remove (refused while agents run on
 * it, naming them).
 */
export function AiPartSection({
  provider,
  part,
  subscriptions,
  update,
}: Pick<CardProps, 'subscriptions' | 'update'> & {
  readonly provider: ProfileProvider;
  readonly part: Part;
}) {
  const { name, icon } = PART_STYLES[provider];
  const addHref = usePersonalHref('subscriptions', true);
  const addGatewayHref = usePersonalHref('gateways', true);
  const options = subscriptionOptions(provider, subscriptions, part.subscription);
  const save = (change: Record<string, unknown>) => update(aiPartChange(provider, change));
  return (
    <PartFrame name={name} icon={icon} onRemove={() => update(aiPartChange(provider, null))}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SavedSelect
          label="Subscription"
          hint={
            options.length <= 1 && (
              <Link to={addHref} className="font-semibold text-blue hover:underline">
                Add a subscription
              </Link>
            )
          }
          value={part.subscription?.id ?? ''}
          options={options}
          save={(credentialId) => save({ credentialId })}
        />
        <SavedSelect
          label="Gateway"
          hint={
            !hasGateway(subscriptions) &&
            !part.gateway && (
              <Link to={addGatewayHref} className="font-semibold text-blue hover:underline">
                Add a gateway
              </Link>
            )
          }
          value={part.gateway?.id ?? ''}
          options={gatewayOptions(subscriptions, part.gateway)}
          save={(gatewayCredentialId) => save({ gatewayCredentialId })}
        />
        <RunsFields
          provider={provider}
          runs={{ model: part.model, effort: part.effort }}
          onChange={(change) => save(change)}
        />
        <ModeField provider={provider} mode={part.mode} onChange={(mode) => save({ mode })} />
      </div>
    </PartFrame>
  );
}

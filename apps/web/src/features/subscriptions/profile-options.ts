import { fitsGateway, fitsProvider, GATEWAY_KINDS, PROVIDER_KINDS } from '@mwc/shared/credentials';
import type { ProfileProvider } from '@mwc/shared/enums';
import type { AccessProfile, Subscription } from '../../api/types.ts';
import type { SelectOption } from '../../components/forms/Input.tsx';
import { kindLabel } from './KindBadge.tsx';

/** A profile's subscription or gateway as the profile shows it. */
type Held = AccessProfile['subscription'];

/**
 * `none` first, then the person's subscriptions of `kinds` that `fits` takes, grouped by kind in the order the kinds
 * are listed; a revoked one only while the profile holds it (it stays until replaced, never put in).
 */
function options(
  subscriptions: readonly Subscription[],
  current: Held,
  wanted: { readonly kinds: readonly string[]; readonly fits: (kind: Subscription['kind']) => boolean },
  none: string,
): SelectOption[] {
  const fitting = subscriptions
    .filter((s) => wanted.fits(s.kind) && (s.status !== 'revoked' || s.id === current?.id))
    .sort((a, b) => wanted.kinds.indexOf(a.kind) - wanted.kinds.indexOf(b.kind));
  const choices = current && !fitting.some((s) => s.id === current.id) ? [current, ...fitting] : fitting;
  return [
    { value: '', label: none },
    ...choices.map((s) => ({
      value: s.id,
      label: s.status === 'revoked' ? `${s.label} (revoked)` : s.label,
      group: kindLabel(s.kind),
    })),
  ];
}

/** The choices of a `provider` profile's subscription: None, then the person's subscriptions of that provider. */
export const subscriptionOptions = (
  provider: ProfileProvider,
  subscriptions: readonly Subscription[],
  current: Held = null,
  none = 'None',
): SelectOption[] =>
  options(
    subscriptions,
    current,
    { kinds: PROVIDER_KINDS[provider], fits: (kind) => fitsProvider(provider, kind) },
    none,
  );

/** The choices of a Claude profile's gateway: None, then the person's gateways. */
export const gatewayOptions = (
  subscriptions: readonly Subscription[],
  current: Held = null,
): SelectOption[] => options(subscriptions, current, { kinds: GATEWAY_KINDS, fits: fitsGateway }, 'None');

/** True when the person has a gateway that a profile can take. */
export const hasGateway = (subscriptions: readonly Subscription[]): boolean =>
  subscriptions.some((s) => fitsGateway(s.kind) && s.status !== 'revoked');

/** The profiles of one provider, in the order the list has them. */
export const profilesOf = (profiles: readonly AccessProfile[], provider: ProfileProvider): AccessProfile[] =>
  profiles.filter((profile) => profile.provider === provider);

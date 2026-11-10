import {
  fitsGateway,
  fitsProvider,
  GATEWAY_KINDS,
  gatewayFitsProfile,
  PROVIDER_KINDS,
} from '@mwc/shared/credentials';
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
  wanted: { readonly kinds: readonly string[]; readonly fits: (subscription: Subscription) => boolean },
  none: string,
): SelectOption[] {
  const fitting = subscriptions
    .filter((s) => wanted.fits(s) && (s.status !== 'revoked' || s.id === current?.id))
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
    { kinds: PROVIDER_KINDS[provider], fits: (s) => fitsProvider(provider, s.kind) },
    none,
  );

/** True when `s` is a gateway of the provider a `provider` profile takes (Claude Code's for Claude, Codex's for OpenAI). */
const gatewayFor = (provider: ProfileProvider, s: Subscription): boolean =>
  fitsGateway(s.kind) && gatewayFitsProfile(provider, s.accountMeta);

/** The choices of a `provider` profile's gateway (Claude unless said): None, then the person's gateways of it. */
export const gatewayOptions = (
  subscriptions: readonly Subscription[],
  current: Held = null,
  provider: ProfileProvider = 'claude',
): SelectOption[] =>
  options(subscriptions, current, { kinds: GATEWAY_KINDS, fits: (s) => gatewayFor(provider, s) }, 'None');

/** True when the person has a gateway that a `provider` profile (Claude unless said) can take. */
export const hasGateway = (
  subscriptions: readonly Subscription[],
  provider: ProfileProvider = 'claude',
): boolean => subscriptions.some((s) => gatewayFor(provider, s) && s.status !== 'revoked');

/** The profiles of one provider, in the order the list has them. */
export const profilesOf = (profiles: readonly AccessProfile[], provider: ProfileProvider): AccessProfile[] =>
  profiles.filter((profile) => profile.provider === provider);

import {
  fitsGateway,
  fitsProvider,
  fitsTool,
  GATEWAY_KINDS,
  PROVIDER_KINDS,
  TOOL_KINDS,
} from '@mwc/shared/credentials';
import type { ProfileProvider, ToolProvider } from '@mwc/shared/enums';
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

/** The choices of a profile's `tool` part's sign-in: None, then the person's sign-ins of that tool. */
export const signInOptions = (
  tool: ToolProvider,
  subscriptions: readonly Subscription[],
  current: Held = null,
): SelectOption[] =>
  options(subscriptions, current, { kinds: TOOL_KINDS[tool], fits: (s) => fitsTool(tool, s.kind) }, 'None');

/** The first sign-in a new `tool` part takes: the person's first of that tool that is not revoked, else none. */
export const firstSignIn = (tool: ToolProvider, subscriptions: readonly Subscription[]): string | null =>
  subscriptions.find((s) => fitsTool(tool, s.kind) && s.status !== 'revoked')?.id ?? null;

/** The choices of any profile's gateway, Claude or OpenAI alike (gateways are universal): None, then every gateway. */
export const gatewayOptions = (
  subscriptions: readonly Subscription[],
  current: Held = null,
): SelectOption[] =>
  options(subscriptions, current, { kinds: GATEWAY_KINDS, fits: (s) => fitsGateway(s.kind) }, 'None');

/** True when the person has a gateway a profile can take (any one not revoked). */
export const hasGateway = (subscriptions: readonly Subscription[]): boolean =>
  subscriptions.some((s) => fitsGateway(s.kind) && s.status !== 'revoked');

/** The profiles of one provider, in the order the list has them. */
export const profilesOf = (profiles: readonly AccessProfile[], provider: ProfileProvider): AccessProfile[] =>
  profiles.filter((profile) => profile.provider === provider);

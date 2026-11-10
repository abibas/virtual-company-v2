import { Waypoints } from 'lucide-react';
import type { SignInProvider, Subscription, SubscriptionKind } from '../../api/types.ts';
import { Badge, type Tone } from '../../components/ui/Badge.tsx';
import type { IconComponent } from '../../components/ui/icon.ts';
import { ClaudeMark, OpenAIMark } from '../../components/ui/ProviderLogo.tsx';

/**
 * What each kind of subscription is called and looks like: Anthropic's kinds in violet, OpenAI's in teal, gateways
 * neutral, each provider's kinds with its logo; the logins and the setup-token have plan limits, keys and gateways
 * are pay as you go.
 */
interface KindStyle {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconComponent;
  /** The provider has plan limits for it (5-hour and weekly windows). */
  readonly limited: boolean;
  /** The sign-in that adds it again, for the two logins. */
  readonly signIn?: SignInProvider;
}

const KINDS: Readonly<Record<SubscriptionKind, KindStyle>> = {
  claude_oauth: {
    label: 'Claude subscription',
    tone: 'review',
    icon: ClaudeMark,
    limited: true,
    signIn: 'claude',
  },
  claude_setup_token: { label: 'Claude token', tone: 'review', icon: ClaudeMark, limited: true },
  anthropic_api_key: { label: 'Anthropic API key', tone: 'review', icon: ClaudeMark, limited: false },
  codex_oauth: {
    label: 'OpenAI subscription',
    tone: 'teal',
    icon: OpenAIMark,
    limited: true,
    signIn: 'openai',
  },
  openai_api_key: { label: 'OpenAI API key', tone: 'teal', icon: OpenAIMark, limited: false },
  gateway: { label: 'Gateway', tone: 'neutral', icon: Waypoints, limited: false },
};

/** The kind as people read it ("Claude subscription"). */
export const kindLabel = (kind: SubscriptionKind): string => KINDS[kind].label;

/** The kind's icon (the add sheet's choices show the same logos, on neutral tiles). */
export const kindIcon = (kind: SubscriptionKind): IconComponent => KINDS[kind].icon;

/** True when the provider sets plan limits for it; keys and gateways are pay as you go. */
export const hasLimits = (kind: SubscriptionKind): boolean => KINDS[kind].limited;

/** The sign-in that adds a login again (Sign in again on a login that needs it); none for pasted kinds. */
export const signInOf = (kind: SubscriptionKind): SignInProvider | undefined => KINDS[kind].signIn;

/** The provider's name, as the sign-in steps say it. */
export const PROVIDER_NAMES: Readonly<Record<SignInProvider, string>> = {
  claude: 'Anthropic',
  openai: 'OpenAI',
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The line under a subscription's name: its account (left out when the name already says it), its plan as the
 * provider names it ("Max plan"), or a gateway's address.
 */
export function accountLine(
  subscription: Pick<Subscription, 'label' | 'accountEmail' | 'accountMeta'>,
): string {
  const meta = subscription.accountMeta;
  const plan = text(meta.subscriptionType) ?? text(meta.planType);
  const email = subscription.accountEmail;
  const parts = [
    email && !subscription.label.includes(email) ? email : undefined,
    plan ? `${capital(plan)} plan` : undefined,
    text(meta.baseUrl),
  ].filter((part): part is string => part !== undefined);
  return parts.join(' · ');
}

/** A subscription's kind as a small badge with its icon. */
export function KindBadge({
  kind,
  size = 'sm',
}: {
  readonly kind: SubscriptionKind;
  readonly size?: 'sm' | 'md';
}) {
  const { label, tone, icon } = KINDS[kind];
  return (
    <Badge tone={tone} icon={icon} size={size}>
      {label}
    </Badge>
  );
}

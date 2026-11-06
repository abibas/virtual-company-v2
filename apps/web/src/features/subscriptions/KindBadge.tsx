import { KeyRound, type LucideIcon, Sparkles, Ticket, Waypoints } from 'lucide-react';
import type { SignInProvider, Subscription, SubscriptionKind } from '../../api/types.ts';
import { Badge, type Tone } from '../../components/ui/Badge.tsx';

/**
 * What each kind of subscription is called and looks like: Anthropic's kinds in violet, OpenAI's in teal, gateways
 * neutral; the logins and the setup-token have plan limits, keys and gateways are pay as you go.
 */
interface KindStyle {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: LucideIcon;
  /** The provider has plan limits for it (5-hour and weekly windows). */
  readonly limited: boolean;
  /** The sign-in that adds it again, for the two logins. */
  readonly signIn?: SignInProvider;
}

const KINDS: Readonly<Record<SubscriptionKind, KindStyle>> = {
  claude_oauth: {
    label: 'Claude subscription',
    tone: 'review',
    icon: Sparkles,
    limited: true,
    signIn: 'claude',
  },
  claude_setup_token: { label: 'Claude token', tone: 'review', icon: Ticket, limited: true },
  anthropic_api_key: { label: 'Anthropic API key', tone: 'review', icon: KeyRound, limited: false },
  codex_oauth: {
    label: 'OpenAI subscription',
    tone: 'teal',
    icon: Sparkles,
    limited: true,
    signIn: 'openai',
  },
  openai_api_key: { label: 'OpenAI API key', tone: 'teal', icon: KeyRound, limited: false },
  gateway: { label: 'Gateway', tone: 'neutral', icon: Waypoints, limited: false },
};

/** The kind as people read it ("Claude subscription"). */
export const kindLabel = (kind: SubscriptionKind): string => KINDS[kind].label;

/** The kind's icon (the add sheet's choices use the same ones). */
export const kindIcon = (kind: SubscriptionKind): LucideIcon => KINDS[kind].icon;

/** The kind's tone. */
export const kindTone = (kind: SubscriptionKind): Tone => KINDS[kind].tone;

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

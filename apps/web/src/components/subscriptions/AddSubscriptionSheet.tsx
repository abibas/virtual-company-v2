import type { PastedCredentialKind } from '@mwc/shared/credentials';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SignInProvider, Subscription, SubscriptionKind } from '../../api/types.ts';
import { List, ListRow } from '../data/List.tsx';
import { Sheet } from '../layout/Drawer.tsx';
import { Badge } from '../ui/Badge.tsx';
import { kindIcon, kindTone } from './KindBadge.tsx';
import { PasteForm, pasteTitle } from './PasteForm.tsx';
import { SignInFlow } from './SignInFlow.tsx';
import type { AddStep, AddSubscription } from './sign-in.ts';

interface Choice {
  readonly title: string;
  readonly subtitle: string;
  /** The kind it adds, for its icon and tone. */
  readonly kind: SubscriptionKind;
}

const SIGN_INS: readonly (Choice & { readonly provider: SignInProvider })[] = [
  {
    provider: 'claude',
    kind: 'claude_oauth',
    title: 'Sign in with Claude',
    subtitle: 'Your Pro or Max plan, with live limits',
  },
  {
    provider: 'openai',
    kind: 'codex_oauth',
    title: 'Sign in with OpenAI',
    subtitle: 'Your ChatGPT plan, for Codex agents',
  },
];

const PASTES: readonly (Choice & { readonly kind: PastedCredentialKind })[] = [
  { kind: 'claude_setup_token', title: 'Paste a Claude setup-token', subtitle: 'Inference only, for a year' },
  { kind: 'anthropic_api_key', title: 'Anthropic API key', subtitle: 'Pay as you go' },
  { kind: 'openai_api_key', title: 'OpenAI API key', subtitle: 'Pay as you go' },
  { kind: 'gateway', title: 'AI gateway', subtitle: 'An address and its headers' },
];

const SIGN_IN_NAMES: Readonly<Record<SignInProvider, string>> = { claude: 'Claude', openai: 'OpenAI' };

/** One group of choices under its small heading. */
function ChoiceGroup({ heading, children }: { readonly heading: string; readonly children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-2 text-xs font-semibold text-dim">{heading}</h3>
      <List>{children}</List>
    </section>
  );
}

/** The ways to add one: the two sign-ins first (Claude recommended), then the pasted kinds. */
function Choices({ adding }: { readonly adding: AddSubscription }) {
  const choice = (item: Choice, onClick: () => void, recommended = false) => (
    <ListRow
      key={item.kind}
      icon={kindIcon(item.kind)}
      tone={kindTone(item.kind)}
      title={item.title}
      subtitle={item.subtitle}
      onClick={onClick}
      trailing={
        <span className="flex shrink-0 items-center gap-2">
          {recommended && (
            <Badge tone="blue" size="sm">
              Recommended
            </Badge>
          )}
          <ChevronRight size={16} aria-hidden="true" className="text-faint" />
        </span>
      }
    />
  );
  return (
    <div className="-mx-2 flex flex-col gap-5">
      <ChoiceGroup heading="Sign in">
        {SIGN_INS.map((item, index) => choice(item, () => adding.signInWith(item.provider), index === 0))}
      </ChoiceGroup>
      <ChoiceGroup heading="Paste">
        {PASTES.map((item) => choice(item, () => adding.paste(item.kind)))}
      </ChoiceGroup>
      <p className="flex items-start gap-2 px-2 text-xs text-dim">
        <ShieldCheck size={15} aria-hidden="true" className="mt-px shrink-0 text-done" />
        Stored encrypted under you and never shown back, not even to you. Only agents you give an access
        profile use it.
      </p>
    </div>
  );
}

const titleOf = (step: AddStep): string =>
  step.kind === 'choose'
    ? 'Add a subscription'
    : step.kind === 'sign-in'
      ? `Sign in with ${SIGN_IN_NAMES[step.provider]}`
      : pasteTitle(step.paste);

/**
 * Add a subscription, in a sheet beside the page (the Subscriptions page, the home widget): the choices, then Sign in
 * with Claude or OpenAI live, or a paste form. Closing it cancels a sign-in in progress. `onAdded` hears of each new
 * subscription (a sign-in's through `useAddSubscription`).
 */
export function AddSubscriptionSheet({
  adding,
  onAdded,
}: {
  readonly adding: AddSubscription;
  readonly onAdded: (subscription: Subscription) => void;
}) {
  const { step } = adding;
  return (
    <Sheet
      open={adding.open}
      onClose={adding.close}
      title={titleOf(step)}
      description={
        step.kind === 'choose' ? 'Your own AI subscriptions, for the agents you power.' : undefined
      }
    >
      {step.kind === 'choose' && <Choices adding={adding} />}
      {step.kind === 'sign-in' && (
        <SignInFlow
          provider={step.provider}
          control={adding.signIn}
          onBack={adding.back}
          onDone={adding.close}
        />
      )}
      {step.kind === 'paste' && (
        <PasteForm
          key={step.paste}
          kind={step.paste}
          onBack={adding.back}
          onAdded={(subscription) => {
            onAdded(subscription);
            adding.close();
          }}
        />
      )}
    </Sheet>
  );
}

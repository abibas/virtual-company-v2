import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Subscription } from '../../api/types.ts';
import { List, ListRow } from '../../components/data/List.tsx';
import { Sheet } from '../../components/layout/Drawer.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import type { IconComponent } from '../../components/ui/icon.ts';
import { AtlassianMark, GitHubMark, SlackMark } from '../../components/ui/ProviderLogo.tsx';
import { SignInFlow } from '../subscriptions/SignInFlow.tsx';
import { type SignInControl, useSignIn } from '../subscriptions/sign-in.ts';
import { type PastedTool, type Renewal, ToolForm } from './ToolForm.tsx';

/** Where the sheet is: its choices, Sign in with GitHub, or a form (a renewal's with its sign-in). */
export type ToolStep =
  | { readonly kind: 'choose' }
  | { readonly kind: 'sign-in'; readonly credentialId?: string }
  | { readonly kind: 'form'; readonly tool: PastedTool; readonly renew?: Renewal };

export interface AddTool {
  readonly open: boolean;
  readonly step: ToolStep;
  readonly signIn: SignInControl;
  choose(): void;
  /** Starts Sign in with GitHub (the person's click is the request); with `credentialId`, it renews that sign-in. */
  signInWithGitHub(credentialId?: string): void;
  form(tool: PastedTool, renew?: Renewal): void;
  back(): void;
  close(): void;
}

/** The sheet's state, held by the Tools part; `onSignedIn` hears of a GitHub sign-in's new or renewed sign-in. */
export function useAddTool(onSignedIn: (credentialId: string) => void): AddTool {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ToolStep>({ kind: 'choose' });
  const signIn = useSignIn(onSignedIn);
  const show = (next: ToolStep) => {
    setStep(next);
    setOpen(true);
  };
  return {
    open,
    step,
    signIn,
    choose: () => show({ kind: 'choose' }),
    signInWithGitHub: (credentialId) => {
      show(credentialId === undefined ? { kind: 'sign-in' } : { kind: 'sign-in', credentialId });
      signIn.start('github', credentialId);
    },
    form: (tool, renew) => show(renew === undefined ? { kind: 'form', tool } : { kind: 'form', tool, renew }),
    back: () => {
      signIn.stop();
      setStep({ kind: 'choose' });
    },
    close: () => {
      signIn.stop();
      setOpen(false);
    },
  };
}

function Choice({
  icon,
  title,
  onClick,
  recommended = false,
}: {
  readonly icon: IconComponent;
  readonly title: string;
  readonly onClick: () => void;
  readonly recommended?: boolean;
}) {
  return (
    <ListRow
      icon={icon}
      title={title}
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
}

function Group({ heading, children }: { readonly heading: string; readonly children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-2 text-xs font-semibold text-dim">{heading}</h3>
      <List>{children}</List>
    </section>
  );
}

const TITLES: Readonly<Record<PastedTool, readonly [add: string, again: string]>> = {
  github_token: ['Paste a GitHub token', 'New GitHub token'],
  atlassian_api_token: ['Add Atlassian', 'New Atlassian API token'],
  slack: ['Add Slack', 'New Slack token'],
};

function titleOf(step: ToolStep): string {
  if (step.kind === 'choose') return 'Add a tool';
  if (step.kind === 'sign-in') return step.credentialId ? 'Sign in again with GitHub' : 'Sign in with GitHub';
  return TITLES[step.tool][step.renew ? 1 : 0];
}

/**
 * Add a tool sign-in, in a sheet beside the page: GitHub (Sign in with GitHub, or paste a token), Atlassian (site,
 * email, API token) and Slack (a bot's or a user's token); also Sign in again for a card. Closing it cancels a sign-in in progress.
 */
export function AddToolSheet({
  adding,
  onAdded,
}: {
  readonly adding: AddTool;
  readonly onAdded: (signIn: Subscription) => void;
}) {
  const { step } = adding;
  return (
    <Sheet open={adding.open} onClose={adding.close} title={titleOf(step)}>
      {step.kind === 'choose' && (
        <div className="-mx-2 flex flex-col gap-5">
          <Group heading="GitHub">
            <Choice
              icon={GitHubMark}
              title="Sign in with GitHub"
              onClick={() => adding.signInWithGitHub()}
              recommended
            />
            <Choice icon={GitHubMark} title="Paste a token" onClick={() => adding.form('github_token')} />
          </Group>
          <Group heading="Atlassian">
            <Choice
              icon={AtlassianMark}
              title="Jira and Confluence"
              onClick={() => adding.form('atlassian_api_token')}
            />
          </Group>
          <Group heading="Slack">
            <Choice icon={SlackMark} title="Bot or user token" onClick={() => adding.form('slack')} />
          </Group>
        </div>
      )}
      {step.kind === 'sign-in' && (
        <SignInFlow
          provider="github"
          credentialId={step.credentialId}
          control={adding.signIn}
          onBack={adding.back}
          onDone={adding.close}
        />
      )}
      {step.kind === 'form' && (
        <ToolForm
          key={`${step.tool}-${step.renew?.credentialId ?? 'new'}`}
          kind={step.tool}
          renew={step.renew}
          onBack={step.renew ? adding.close : adding.back}
          onAdded={(signIn) => {
            onAdded(signIn);
            adding.close();
          }}
        />
      )}
    </Sheet>
  );
}

import { CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { Check, LogIn, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { cx } from '../../components/cx.ts';
import { formatDateTime, fromNow } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { kindIcon, kindLabel } from '../subscriptions/KindBadge.tsx';
import { type ToolSignIn, toolAccount, toolReach, toolSite } from './tools.ts';

interface ToolCardProps {
  readonly tool: ToolSignIn;
  readonly rename: (label: string) => Promise<unknown>;
  readonly remove: () => Promise<void>;
  /** Check again (`POST .../check`), then the list is read again. */
  readonly check: () => Promise<unknown>;
  readonly signInAgain: () => void;
  /** Just added or renewed: scrolled into view and ringed for a moment. */
  readonly highlighted?: boolean;
}

/** GitHub's scopes, or Jira and Confluence, as small chips; one that does not answer is struck through. */
function Reach({ tool }: { readonly tool: ToolSignIn }) {
  const reach = toolReach(tool);
  if (reach.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Access">
      {reach.map(({ name, on }) => (
        <li
          key={name}
          className={cx(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
            on ? 'bg-surface-2 text-ink-2' : 'bg-surface-2/60 text-faint line-through',
          )}
        >
          {tool.kind === 'atlassian_api_token' &&
            (on ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />)}
          {name}
        </li>
      ))}
    </ul>
  );
}

/** When it was last checked with its provider. */
function Checked({ at }: { readonly at: string | null }) {
  if (at === null) return <p className="min-w-0 text-xs text-dim">Not checked yet</p>;
  return (
    <p className="min-w-0 text-xs text-dim">
      Checked{' '}
      <time dateTime={at} title={formatDateTime(at)}>
        {fromNow(at)}
      </time>
    </p>
  );
}

/** Check again, spinning while it runs, with its refusal under the card. */
function useCheck(check: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = () => {
    setBusy(true);
    setError(undefined);
    check()
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}

/** Check again (spinning while it runs), Sign in again (blue when it needs it) and Remove, confirmed in place. */
function Actions({
  tool,
  checking,
  signInAgain,
  remove,
}: Pick<ToolCardProps, 'tool' | 'signInAgain' | 'remove'> & {
  readonly checking: ReturnType<typeof useCheck>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        tone="quiet"
        icon={RefreshCw}
        disabled={checking.busy}
        onClick={checking.run}
        className={cx(checking.busy && 'motion-safe:[&_svg]:animate-spin')}
      >
        Check again
      </Button>
      <Button
        size="sm"
        tone={tool.status === 'needs_sign_in' ? 'primary' : 'quiet'}
        icon={LogIn}
        onClick={signInAgain}
      >
        Sign in again
      </Button>
      <ConfirmInline
        label="Remove"
        question={`Remove ${tool.label}? Its secret is deleted.`}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}

/**
 * One tool sign-in on the Subscriptions page: its logo and kind, its status, its name (renamed in place), who it acts as,
 * its scopes or products, its last check; Check again, Sign in again and Remove.
 */
export function ToolCard({ tool, rename, remove, check, signInAgain, highlighted = false }: ToolCardProps) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);
  const checking = useCheck(check);
  const account = toolAccount(tool);
  const site = toolSite(tool);
  return (
    <Card
      ref={card}
      as="article"
      aria-label={tool.label}
      className={cx('flex flex-col gap-4 transition-shadow duration-500', highlighted && 'ring-2 ring-blue')}
    >
      <header className="flex items-start gap-3">
        <IconTile icon={kindIcon(tool.kind)} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-dim">{kindLabel(tool.kind)}</span>
            {tool.status !== 'active' && <StatusPill status={tool.status} size="sm" />}
          </div>
          <InlineEdit
            value={tool.label}
            label={`Rename ${tool.label}`}
            maxLength={CREDENTIAL_LABEL.max}
            onSave={rename}
          >
            <span className="text-md font-bold tracking-[-0.01em] text-ink">{tool.label}</span>
          </InlineEdit>
          {account && <p className="truncate text-sm text-dim">{account}</p>}
          {site && <p className="truncate font-mono text-sm text-ink-2">{site}</p>}
        </div>
      </header>
      <Reach tool={tool} />
      {(tool.checkError || checking.error) && (
        <p className="text-xs text-blocked">{checking.error ?? tool.checkError?.message}</p>
      )}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <Checked at={tool.checkedAt} />
        <Actions tool={tool} checking={checking} signInAgain={signInAgain} remove={remove} />
      </footer>
    </Card>
  );
}

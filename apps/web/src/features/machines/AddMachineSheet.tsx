import { ChevronRight, Cloud, Container, Laptop, type LucideIcon } from 'lucide-react';
import { usePublicConfig } from '../../api/config.ts';
import type { EnrollmentToken, Machine, PublicConfig } from '../../api/types.ts';
import { List, ListRow } from '../../components/data/List.tsx';
import { ErrorBlock, LoadingBlock } from '../../components/data/LoadState.tsx';
import { CopyButton } from '../../components/forms/CopyButton.tsx';
import { Sheet } from '../../components/layout/Drawer.tsx';
import type { Tone } from '../../components/ui/Badge.tsx';
import { Button, Spinner } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { useNow } from '../subscriptions/limits.ts';
import type { AddMachine } from './add-machine.ts';
import { COMMAND_HINTS, installCommand, type NewMachineKind } from './install-commands.ts';

interface Choice {
  readonly kind: NewMachineKind;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: LucideIcon;
  readonly tone: Tone;
}

const CHOICES: readonly Choice[] = [
  { kind: 'mac', title: 'This Mac', subtitle: 'Agents run on your own Mac', icon: Laptop, tone: 'blue' },
  {
    kind: 'devbox',
    title: 'Airia devbox',
    subtitle: 'Your cloud box, started and stopped from here',
    icon: Cloud,
    tone: 'teal',
  },
  {
    kind: 'container',
    title: 'Docker container',
    subtitle: 'A runner in a container beside the server',
    icon: Container,
    tone: 'review',
  },
];

/** The kinds of machine, one row each. */
function Choices({ onPick }: { readonly onPick: (kind: NewMachineKind) => void }) {
  return (
    <div className="-mx-2 flex flex-col gap-4">
      <List>
        {CHOICES.map((choice) => (
          <ListRow
            key={choice.kind}
            icon={choice.icon}
            tone={choice.tone}
            title={choice.title}
            subtitle={choice.subtitle}
            onClick={() => onPick(choice.kind)}
            trailing={<ChevronRight size={16} aria-hidden="true" className="text-faint" />}
          />
        ))}
      </List>
      <p className="px-2 text-xs text-dim">
        You get a one-time command with a token good for one machine within the hour. The machine connects to
        this server by itself; nothing is installed until you run it.
      </p>
    </div>
  );
}

/** "59:12" left of the token's hour. */
function leftText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The token's countdown, or that it expired with a way to make a new one. */
function Countdown({ expiresAt, onAgain }: { readonly expiresAt: string; readonly onAgain: () => void }) {
  const now = useNow(1000);
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-failed">
        The token expired.
        <Button size="sm" tone="soft" onClick={onAgain}>
          Make a new one
        </Button>
      </p>
    );
  }
  return (
    <p className="text-xs text-dim">
      Good for one machine for <span className="font-semibold text-ink-2 tabular">{leftText(left)}</span>
    </p>
  );
}

/**
 * The install command for the chosen kind with its one-time token, Copy, the hour's countdown, and the machine once
 * it connects. For the devbox without a public address, what to set first instead.
 */
function EnrollCommand({
  kind,
  token,
  config,
  connected,
  onAgain,
}: {
  readonly kind: NewMachineKind;
  readonly token: EnrollmentToken;
  readonly config: PublicConfig;
  readonly connected: Machine | undefined;
  readonly onAgain: () => void;
}) {
  const install = installCommand(kind, token.token, config);
  if (install.kind === 'note') {
    return (
      <Notice tone="warning" title={install.note}>
        The devbox reaches this server only at its public address. Set it, restart the server, then add the
        box again.
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <pre className="overflow-x-auto rounded-xl bg-surface-2 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-ink-2">
        <code>{install.command}</code>
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Countdown expiresAt={token.expiresAt} onAgain={onAgain} />
        <CopyButton text={install.command} label="Copy command" />
      </div>
      <p className="text-xs text-dim">{COMMAND_HINTS[kind]}</p>
      {connected ? (
        <Notice tone="success">Connected: {connected.name}</Notice>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-dim">
          <Spinner />
          Waiting for the machine to connect…
        </p>
      )}
    </div>
  );
}

const titleOf = (kind: NewMachineKind | undefined) =>
  CHOICES.find((choice) => choice.kind === kind)?.title ?? 'Add a machine';

/** Add a machine (admins): the kind, then its install command with the token, and the machine once it connects. */
export function AddMachineSheet({ adding }: { readonly adding: AddMachine }) {
  const config = usePublicConfig();
  const { kind, token } = adding;
  return (
    <Sheet
      open={adding.open}
      onClose={adding.close}
      title={kind ? `Add ${titleOf(kind)}` : 'Add a machine'}
      description={kind ? undefined : 'Where your agents will run.'}
    >
      {kind === undefined && <Choices onPick={adding.pick} />}
      {kind !== undefined && (
        <div className="flex flex-col gap-4">
          {adding.busy && <LoadingBlock label="Making a one-time token…" />}
          {adding.error !== undefined && (
            <ErrorBlock error={adding.error} onRetry={() => adding.pick(kind)} />
          )}
          {token && (
            <EnrollCommand
              kind={kind}
              token={token}
              config={config}
              connected={adding.connected}
              onAgain={() => adding.pick(kind)}
            />
          )}
          <div className="flex justify-between gap-2">
            <Button size="sm" tone="quiet" onClick={adding.back}>
              Back
            </Button>
            <Button size="sm" tone={adding.connected ? 'primary' : 'secondary'} onClick={adding.close}>
              {adding.connected ? 'Done' : 'Close'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

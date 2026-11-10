import type { AgentStatus } from '@mwc/shared/enums';
import { ArchiveRestore, type LucideIcon, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { OrgCalls } from '../../api/org.ts';
import type { AgentDetail, ChartNode } from '../../api/types.ts';
import { formatDate, formatDateTime } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { harnessLabel, profileLabel, runsLine } from '../../components/org/agent-labels.ts';
import { nodeName } from '../../components/org/chart.ts';
import { AgentAvatar } from '../../components/org/OrgNodeCard.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { Button, type ButtonTone } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { ChatButton } from '../chats/ChatButton.tsx';
import { placementLine } from '../placements/placement-draft.ts';

interface StatusProps {
  readonly agent: AgentDetail;
  readonly calls: OrgCalls;
  /** The agent after the change. */
  readonly onChanged: (agent: AgentDetail) => void;
}

/** The one status change each status offers besides Archive: Pause, Resume, or Restore. */
const NEXT: Readonly<
  Record<AgentStatus, { to: AgentStatus; label: string; icon: LucideIcon; tone: ButtonTone }>
> = {
  active: { to: 'paused', label: 'Pause', icon: Pause, tone: 'secondary' },
  paused: { to: 'active', label: 'Resume', icon: Play, tone: 'soft' },
  archived: { to: 'active', label: 'Restore', icon: ArchiveRestore, tone: 'primary' },
};

/** Pause or Resume, Archive (confirmed in place), or Restore for an archived agent; a refusal shows under them. */
function StatusActions({ agent, calls, onChanged }: StatusProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const next = NEXT[agent.status];
  const change = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onChanged(await calls.update(agent.id, { status: next.to }));
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-start justify-end gap-2">
        <Button size="sm" tone={next.tone} icon={next.icon} busy={busy} onClick={() => void change()}>
          {next.label}
        </Button>
        {agent.status !== 'archived' && (
          <ConfirmInline
            label="Archive"
            question={`Archive ${agent.name}? It leaves the chart, and its reports move up to its manager.`}
            confirmLabel="Archive"
            onConfirm={() => calls.update(agent.id, { status: 'archived' }).then(onChanged)}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The facts under the name: its handle, its manager, what powers it and on whose access profile, the machine it runs
 * on and how, its revision and when it was hired.
 */
function AgentFacts({
  agent,
  manager,
}: {
  readonly agent: AgentDetail;
  readonly manager: ChartNode | undefined;
}) {
  const facts: readonly [string, string][] = [
    ['Handle', agent.slug],
    ['Reports to', manager ? nodeName(manager) : agent.status === 'archived' ? 'Off the chart' : '—'],
    ['Powered by', `${harnessLabel(agent.harness)}, ${runsLine(agent.runsWith)}`],
    ['Runs on', placementLine(agent.placement)],
    ['Access profile', profileLabel(agent.profile)],
    ['Instructions', `Revision ${agent.instructionsRev}`],
  ];
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {facts.map(([term, value]) => (
        <div key={term} className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-dim">{term}</dt>
          <dd
            className={
              term === 'Handle'
                ? 'truncate font-mono text-xs leading-5 text-ink-2'
                : 'truncate font-medium text-ink'
            }
          >
            {value}
          </dd>
        </div>
      ))}
      <div className="flex gap-2">
        <dt className="text-dim">Hired</dt>
        <dd className="font-medium text-ink">
          <time dateTime={agent.createdAt} title={formatDateTime(agent.createdAt)}>
            {formatDate(agent.createdAt)}
          </time>
        </dd>
      </div>
    </dl>
  );
}

/**
 * The top of an agent's page: its face, status, name and role, its facts, its Chat button (to its chats, S5.1c) and
 * (admins) its status actions.
 */
export function AgentHeader({
  manager,
  admin,
  chatsHref,
  ...status
}: StatusProps & {
  readonly manager: ChartNode | undefined;
  readonly admin: boolean;
  readonly chatsHref: string;
}) {
  const { agent } = status;
  return (
    <Card as="section" aria-label={agent.name} padding="lg" className="ring-1 ring-teal/25">
      <span aria-hidden="true" className="absolute inset-x-6 top-0 h-1 rounded-b-full bg-teal" />
      <div className="flex flex-wrap items-start gap-4 md:gap-5">
        <AgentAvatar agent={agent} size="xl" className="shadow-card" />
        <div className="min-w-0 flex-1">
          <StatusPill status={agent.status} />
          <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] break-words text-ink">
            {agent.name}
          </h2>
          <p className="mt-0.5 text-md text-ink-2">{agent.roleTitle}</p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <ChatButton href={chatsHref} placed={agent.placement !== null} tone="soft" />
          {admin && <StatusActions {...status} />}
        </div>
      </div>
      <AgentFacts agent={agent} manager={manager} />
    </Card>
  );
}

import type { ReactNode } from 'react';
import type { MachineStats } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { MachineLogo } from './MachineLogo.tsx';
import { MachineMetrics } from './MachineMetrics.tsx';
import { kindName, statusText } from './machine-text.ts';

/**
 * A machine's status line: a dot, "Running · up 8d 3h" or "Asleep · last seen 5 min ago", and "· 3 agents" (the agents
 * placed on it).
 */
export function MachineStatus({
  stats,
  now,
  agents,
}: {
  readonly stats: Pick<MachineStats, 'status' | 'kind' | 'lastSeenAt' | 'upSince'>;
  readonly now: number;
  readonly agents?: number | undefined;
}) {
  const { words, tone } = statusText(stats, now);
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-dim">
      <span
        aria-hidden="true"
        className={cx(
          'size-1.5 shrink-0 rounded-full',
          tone === 'done' ? 'bg-done' : tone === 'input' ? 'bg-input' : 'bg-faint',
        )}
      />
      <span className="truncate">
        {words}
        {agents !== undefined && ` · ${agents} ${agents === 1 ? 'agent' : 'agents'}`}
      </span>
    </p>
  );
}

/** What the identity line needs: the stats' own fields, or a machine's with its stats' `upSince` and badge. */
export type IdentityFacts = Pick<
  MachineStats,
  'name' | 'kind' | 'provider' | 'status' | 'lastSeenAt' | 'upSince'
> & {
  readonly overloaded?: { readonly badge: boolean } | undefined;
  readonly agentCount?: number | undefined;
};

/**
 * The machine's mark (its logo or kind icon, `MachineLogo`), name, kind and status, with the Overloaded badge; `name`
 * replaces the plain name (a rename).
 */
export function MachineIdentity({
  stats,
  now,
  mark,
  name,
  badges,
  aside,
}: {
  readonly stats: IdentityFacts;
  readonly now: number;
  readonly mark: ReactNode;
  readonly name?: ReactNode;
  /** More badges on the name's line (the card's "Runner out of date"). */
  readonly badges?: ReactNode;
  readonly aside?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3">
      {mark}
      <div className="min-w-0 flex-1">
        <h3 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink">
          {name ?? <span className="truncate">{stats.name}</span>}
          <span className="text-xs font-medium text-faint">{kindName(stats.kind, stats.provider)}</span>
          {stats.overloaded?.badge && (
            <Badge tone="failed" size="sm" dot>
              Overloaded
            </Badge>
          )}
          {badges}
        </h3>
        <MachineStatus stats={stats} now={now} agents={stats.agentCount} />
      </div>
      {aside}
    </header>
  );
}

/** One machine on the home board: who it is (its logo, else its kind icon) and how it is, then its stats row. */
export function MachineStatsRow({
  stats,
  now,
  companyId,
}: {
  readonly stats: MachineStats;
  readonly now: number;
  readonly companyId: string;
}) {
  const mark = {
    companyId,
    machineId: stats.machineId,
    name: stats.name,
    kind: stats.kind,
    online: stats.status === 'online',
    logoVersion: stats.logo?.version,
  };
  return (
    <Card as="article" variant="soft" padding="sm" aria-label={stats.name} className="flex flex-col gap-4">
      <MachineIdentity stats={stats} now={now} mark={<MachineLogo mark={mark} />} />
      <MachineMetrics stats={stats} />
    </Card>
  );
}

import type { ReactNode } from 'react';
import type { MachineStats } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { IconTile } from '../../components/ui/IconTile.tsx';
import { MachineMetrics } from './MachineMetrics.tsx';
import { kindIcon, kindName, statusText } from './machine-text.ts';

/**
 * A machine's status line: a dot and "Running · up 8d 3h" or "Asleep · last seen 5 min ago". `agents` is the spot
 * for "N agents", for when the API counts the agents placed on each machine.
 */
export function MachineStatus({
  stats,
  now,
  agents,
}: {
  readonly stats: Pick<MachineStats, 'status' | 'kind' | 'lastSeenAt' | 'upSince'>;
  readonly now: number;
  readonly agents?: number;
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
};

/** The machine's mark, name, kind and status, with the Overloaded badge; `name` replaces the plain name (a rename). */
export function MachineIdentity({
  stats,
  now,
  name,
  aside,
}: {
  readonly stats: IdentityFacts;
  readonly now: number;
  readonly name?: ReactNode;
  readonly aside?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3">
      <IconTile icon={kindIcon(stats.kind)} tone={stats.status === 'online' ? 'blue' : 'neutral'} />
      <div className="min-w-0 flex-1">
        <h3 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink">
          {name ?? <span className="truncate">{stats.name}</span>}
          <span className="text-xs font-medium text-faint">{kindName(stats.kind, stats.provider)}</span>
          {stats.overloaded?.badge && (
            <Badge tone="failed" size="sm" dot>
              Overloaded
            </Badge>
          )}
        </h3>
        <MachineStatus stats={stats} now={now} />
      </div>
      {aside}
    </header>
  );
}

/** One machine on the home board: who it is and how it is, then its stats row. */
export function MachineStatsRow({ stats, now }: { readonly stats: MachineStats; readonly now: number }) {
  return (
    <Card as="article" variant="soft" padding="sm" aria-label={stats.name} className="flex flex-col gap-4">
      <MachineIdentity stats={stats} now={now} />
      <MachineMetrics stats={stats} />
    </Card>
  );
}

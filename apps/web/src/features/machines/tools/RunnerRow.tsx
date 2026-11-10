import type { LatestRunner, Machine } from '../../../api/types.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { type RunnerUpdate, UpdateRunnerButton } from '../runner/RunnerUpdate.tsx';
import {
  CONTAINER_UPDATE_INFO,
  runnerOutOfDate,
  runnerUpToDate,
  versionText,
} from '../runner/runner-text.ts';

/**
 * The runner itself in the card's Software part: its version and build time, and whether it is the build this server
 * hands out ("up to date" only when that is known). A container's runner is updated by rebuilding the container: for
 * admins, while it is out of date, the row has **Update container** and a line saying what that does.
 */
export function RunnerRow({
  machine,
  latest,
  online,
  update,
}: {
  readonly machine: Machine;
  readonly latest: LatestRunner;
  readonly online: boolean;
  /** A container's update and why it waits, for admins; undefined otherwise. */
  readonly update?: { readonly run: RunnerUpdate; readonly blocked: string | undefined } | undefined;
}) {
  const old = runnerOutOfDate(machine, online);
  // The badge names a newer version only (a newer build of the same one is in its tooltip and the header's badge), so the
  // row's own version and build stay readable.
  const newer = latest && latest.version !== machine.runner.version ? latest.version : undefined;
  const offered = update !== undefined && (old || update.run.state.kind !== 'idle');
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-28 shrink-0 text-sm font-semibold text-ink">Runner</span>
        <span className="min-w-0 flex-1 truncate text-sm text-dim">
          {versionText(machine.runner.version, machine.runner.builtAt)}
        </span>
        {old && (
          <span title={latest ? `Latest ${versionText(latest.version, latest.builtAt)}` : undefined}>
            <Badge size="sm" tone="input">
              update available{newer ? ` · ${newer}` : ''}
            </Badge>
          </span>
        )}
        {runnerUpToDate(machine, online) && (
          <Badge size="sm" tone="done">
            up to date
          </Badge>
        )}
        {offered && (
          <UpdateRunnerButton
            update={update.run}
            blocked={update.blocked}
            label="Update container"
            title={CONTAINER_UPDATE_INFO}
          />
        )}
      </div>
      {offered && old && <p className="text-xs text-dim">{CONTAINER_UPDATE_INFO}</p>}
    </li>
  );
}

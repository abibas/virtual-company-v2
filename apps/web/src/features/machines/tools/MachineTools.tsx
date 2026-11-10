import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MachineCalls } from '../../../api/machines.ts';
import type { LatestRunner, Machine } from '../../../api/types.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import type { BusyJob } from '../runner/machine-job.ts';
import { runnerOutOfDate, versionText } from '../runner/runner-text.ts';
import { InstallOutcome } from './InstallOutcome.tsx';
import { ToolRow } from './ToolRow.tsx';
import { latestSourceText, machineToolsId, TOOL_ORDER } from './tools-text.ts';
import { type ToolInstall, useToolsCheck } from './use-tools.ts';

/** The runner itself: its version and build time, and whether it is the build this server hands out. */
function RunnerRow({
  machine,
  latest,
  online,
}: {
  readonly machine: Machine;
  readonly latest: LatestRunner;
  readonly online: boolean;
}) {
  const old = runnerOutOfDate(machine, online);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="w-28 shrink-0 text-sm font-semibold text-ink">Runner</span>
      <span className="min-w-0 flex-1 truncate text-sm text-dim">
        {versionText(machine.runner.version, machine.runner.builtAt)}
      </span>
      {online && old && (
        <Badge size="sm" tone="input">
          update available{latest ? ` · ${versionText(latest.version, latest.builtAt)}` : ''}
        </Badge>
      )}
      {online && !old && (
        <Badge size="sm" tone="done">
          up to date
        </Badge>
      )}
    </li>
  );
}

/** The install's output as it comes, kept scrolled to its end. */
function InstallLog({ lines }: { readonly lines: readonly string[] }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (box.current && lines.length > 0) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);
  return (
    <pre
      ref={box}
      title="npm’s output"
      className="max-h-48 overflow-auto rounded-xl bg-surface-2 px-4 py-3 font-mono text-2xs leading-relaxed whitespace-pre-wrap break-all text-ink-2"
    >
      {lines.length === 0 ? 'Waiting for npm…' : lines.join('\n')}
    </pre>
  );
}

/** Why there is no list: the machine offline, or a runner older than the tools. */
function NoTools({ online }: { readonly online: boolean }) {
  return (
    <p className="text-xs text-dim">
      {online
        ? 'This runner does not report its tools yet: update it (Update runner, below).'
        : 'The machine is offline: its tools show once its runner connects.'}
    </p>
  );
}

/**
 * The card's Tools part (docs/machines.md, "Tools"): each CLI its runner found with its version or "not installed",
 * an older Claude Code or Codex marked "update available" (against npm's latest, or the app's pins when npm cannot be
 * read, said in a quiet line under the list); for admins Check again, and Install or Update of Claude Code
 * and Codex (asked first, never in a container) with npm's output and the result. The job running on the machine (an
 * install or a runner update, `job`) shows at the top, and Check again, Install and Update wait for it.
 * `/:slug/machines?machine=<id>#tools` scrolls here.
 */
export function MachineTools({
  machine,
  latestRunner,
  admin,
  online,
  calls,
  install,
  job,
  onChanged,
}: {
  readonly machine: Machine;
  readonly latestRunner: LatestRunner;
  readonly admin: boolean;
  readonly online: boolean;
  readonly calls: MachineCalls;
  /** The card's install (its state is the card's too: a runner update waits for it). */
  readonly install: ToolInstall;
  readonly job: BusyJob | undefined;
  readonly onChanged: () => void;
}) {
  const check = useToolsCheck(calls, machine.id, onChanged);
  const { state } = install;
  const ended = state.kind === 'succeeded' || state.kind === 'failed' ? state : undefined;
  const tools = (online ? (ended?.tools ?? check.tools ?? machine.runner.tools) : null) ?? null;
  const container = machine.kind === 'container';
  return (
    <section
      id={machineToolsId(machine.id)}
      aria-label="Software"
      className="flex min-w-0 scroll-mt-6 flex-col gap-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-ink-2">Software</h4>
        {admin && tools && (
          <Button
            size="sm"
            tone="quiet"
            icon={RefreshCw}
            busy={check.busy}
            disabled={job !== undefined}
            title={job?.reason}
            onClick={check.run}
          >
            Check again
          </Button>
        )}
      </div>
      {job && <Notice tone="info">{job.label}</Notice>}
      {check.error && <p className="text-xs font-medium text-failed">{check.error}</p>}
      <ul className="flex flex-col divide-y divide-line">
        <RunnerRow machine={machine} latest={latestRunner} online={online} />
        {tools !== null &&
          TOOL_ORDER.map((tool) => (
            <ToolRow
              key={tool}
              {...{ tool, machine, tools, install, job }}
              canInstall={admin && !container}
            />
          ))}
      </ul>
      {tools !== null && <p className="text-2xs text-dim">{latestSourceText(machine.runner.toolsLatest)}</p>}
      {tools === null && <NoTools online={online} />}
      {tools && container && (
        <p className="text-xs text-dim">
          In a container its CLIs come from its image: rebuild it to add or update one.
        </p>
      )}
      {state.kind === 'running' && <InstallLog lines={state.lines} />}
      {ended && <InstallLog lines={ended.lines} />}
      <InstallOutcome state={state} latest={machine.runner.toolsLatest} onDismiss={install.dismiss} />
    </section>
  );
}

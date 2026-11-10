import { Download } from 'lucide-react';
import { useState } from 'react';
import type { Machine, MachineTools as Tools } from '../../../api/types.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import type { BusyJob } from '../runner/machine-job.ts';
import { installQuestion, isInstallable, TOOL_LABELS, type ToolKey, toolState } from './tools-text.ts';
import type { ToolInstall } from './use-tools.ts';

/** A CLI's row in the card's Software part (docs/machines.md, "Tools"), with Install or Update asked in place. */

/** Install's question in place: what it does, Cancel and Install. */
function InstallConfirm({
  question,
  label,
  onCancel,
  onConfirm,
}: {
  readonly question: string;
  readonly label: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-soft px-3 py-2">
      <p className="min-w-0 flex-1 text-xs font-medium text-ink">{question}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" tone="primary" icon={Download} onClick={onConfirm}>
          {label}
        </Button>
      </div>
    </div>
  );
}

/** One CLI: its name, its version or "not installed", "update available", and Install or Update for admins. */
export function ToolRow({
  tool,
  machine,
  tools,
  canInstall,
  install,
  job,
}: {
  readonly tool: ToolKey;
  readonly machine: Machine;
  readonly tools: Tools;
  readonly canInstall: boolean;
  readonly install: ToolInstall;
  /** The job running on the machine: Install and Update wait for it. */
  readonly job: BusyJob | undefined;
}) {
  const [asking, setAsking] = useState(false);
  const state = toolState(tools, machine.runner.toolsLatest, tool);
  const busy = install.state.kind === 'starting' || install.state.kind === 'running';
  const mine = 'tool' in install.state && install.state.tool === tool;
  const offered = canInstall && isInstallable(tool) && state.kind !== 'ok';
  const label = state.kind === 'old' ? 'Update' : 'Install';
  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-28 shrink-0 text-sm font-semibold text-ink">{TOOL_LABELS[tool]}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-dim" title={tools[tool] ?? undefined}>
          {state.kind === 'missing' ? 'not installed' : state.version}
        </span>
        {state.kind === 'old' && (
          <Badge size="sm" tone="input">
            update available · {state.latest}
          </Badge>
        )}
        {state.kind === 'ok' && isInstallable(tool) && (
          <Badge size="sm" tone="done">
            up to date
          </Badge>
        )}
        {offered && !asking && (
          <Button
            size="sm"
            tone="soft"
            icon={Download}
            busy={busy && mine}
            disabled={busy || job !== undefined}
            title={job?.reason}
            onClick={() => setAsking(true)}
          >
            {label}
          </Button>
        )}
      </div>
      {offered && asking && isInstallable(tool) && (
        <InstallConfirm
          question={installQuestion(tool, machine.runner.toolsLatest[tool], machine, state.kind === 'old')}
          label={label}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            install.start(tool);
          }}
        />
      )}
    </li>
  );
}

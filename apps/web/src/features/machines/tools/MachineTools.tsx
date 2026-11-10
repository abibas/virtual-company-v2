import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MachineCalls } from '../../../api/machines.ts';
import type { Machine, MachineTools as Tools } from '../../../api/types.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { InstallOutcome } from './InstallOutcome.tsx';
import {
  installQuestion,
  isInstallable,
  machineToolsId,
  TOOL_LABELS,
  TOOL_ORDER,
  type ToolKey,
  toolState,
} from './tools-text.ts';
import { type ToolInstall, useToolInstall, useToolsCheck } from './use-tools.ts';

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
function ToolRow({
  tool,
  machine,
  tools,
  canInstall,
  install,
}: {
  readonly tool: ToolKey;
  readonly machine: Machine;
  readonly tools: Tools;
  readonly canInstall: boolean;
  readonly install: ToolInstall;
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
        {offered && !asking && (
          <Button
            size="sm"
            tone="soft"
            icon={Download}
            busy={busy && mine}
            disabled={busy}
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
 * an older Claude Code or Codex marked "update available"; for admins Check again, and Install or Update of Claude Code
 * and Codex (asked first, never in a container) with npm's output and the result. `/:slug/machines?machine=<id>#tools`
 * scrolls here.
 */
export function MachineTools({
  machine,
  admin,
  online,
  calls,
  onChanged,
}: {
  readonly machine: Machine;
  readonly admin: boolean;
  readonly online: boolean;
  readonly calls: MachineCalls;
  readonly onChanged: () => void;
}) {
  const check = useToolsCheck(calls, machine.id, onChanged);
  const install = useToolInstall(calls, machine.id, onChanged);
  const { state } = install;
  const ended = state.kind === 'succeeded' || state.kind === 'failed' ? state : undefined;
  const tools = (online ? (ended?.tools ?? check.tools ?? machine.runner.tools) : null) ?? null;
  const container = machine.kind === 'container';
  return (
    <section
      id={machineToolsId(machine.id)}
      aria-label="Tools"
      className="flex scroll-mt-6 flex-col gap-2 border-t border-line pt-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-ink-2">Tools</h4>
        {admin && tools && (
          <Button size="sm" tone="quiet" icon={RefreshCw} busy={check.busy} onClick={check.run}>
            Check again
          </Button>
        )}
      </div>
      {check.error && <p className="text-xs font-medium text-failed">{check.error}</p>}
      {tools === null ? (
        <NoTools online={online} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {TOOL_ORDER.map((tool) => (
            <ToolRow key={tool} {...{ tool, machine, tools, install }} canInstall={admin && !container} />
          ))}
        </ul>
      )}
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

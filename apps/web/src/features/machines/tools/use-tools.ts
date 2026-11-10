import { useEffect, useRef, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { MachineCalls } from '../../../api/machines.ts';
import type { InstallableTool, MachineTools } from '../../../api/types.ts';

/** A machine card's Check again and Install (docs/machines.md, "Tools"): their calls, state and the install's output. */

/** How often a running install is read again. */
export const INSTALL_POLL_MS = 1000;

export interface ToolsCheck {
  readonly busy: boolean;
  readonly error: string | undefined;
  /** The tools the last check found (fresher than the card's until it loads again). */
  readonly tools: MachineTools | undefined;
  run(): void;
}

/** Check again: the runner looks for its CLIs again; `onChecked` loads the card again. */
export function useToolsCheck(calls: MachineCalls, machineId: string, onChecked: () => void): ToolsCheck {
  const [state, setState] = useState<{
    readonly busy: boolean;
    readonly error?: string | undefined;
    readonly tools?: MachineTools | undefined;
  }>({ busy: false });
  const run = async () => {
    setState((was) => ({ ...was, busy: true, error: undefined }));
    try {
      const { tools } = await calls.checkTools(machineId);
      setState({ busy: false, tools });
      onChecked();
    } catch (error) {
      setState((was) => ({ ...was, busy: false, error: friendlyMessage(error) }));
    }
  };
  return { busy: state.busy, error: state.error, tools: state.tools, run: () => void run() };
}

export type InstallState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting'; readonly tool: InstallableTool }
  | {
      readonly kind: 'running' | 'succeeded' | 'failed';
      readonly tool: InstallableTool;
      readonly version: string;
      readonly installId: string;
      readonly lines: readonly string[];
      readonly tools: MachineTools | null;
      readonly error: string | null;
    }
  | { readonly kind: 'refused'; readonly tool: InstallableTool; readonly message: string };

export interface ToolInstall {
  readonly state: InstallState;
  start(tool: InstallableTool): void;
  dismiss(): void;
}

/** Install: starts it, reads its output every second until it ends, then `onEnded` loads the card again. */
export function useToolInstall(calls: MachineCalls, machineId: string, onEnded: () => void): ToolInstall {
  const [state, setState] = useState<InstallState>({ kind: 'idle' });
  const ended = useRef(onEnded);
  ended.current = onEnded;
  // The page makes its calls anew on each render: the latest ones, so a render does not restart the wait.
  const latest = useRef(calls);
  latest.current = calls;
  const running = state.kind === 'running' ? state : undefined;
  useEffect(() => {
    if (running === undefined) return;
    const timer = setTimeout(async () => {
      try {
        const read = await latest.current.toolInstall(machineId, running.installId, running.lines.length);
        const next = {
          ...running,
          lines: [...running.lines, ...read.lines],
          tools: read.tools,
          error: read.error,
        };
        setState({ ...next, kind: read.status });
        if (read.status !== 'running') ended.current();
      } catch (error) {
        setState({ ...running, kind: 'failed', error: friendlyMessage(error) });
      }
    }, INSTALL_POLL_MS);
    return () => clearTimeout(timer);
  }, [machineId, running]);
  const start = async (tool: InstallableTool) => {
    setState({ kind: 'starting', tool });
    try {
      const { installId, version } = await calls.installTool(machineId, tool);
      setState({ kind: 'running', tool, version, installId, lines: [], tools: null, error: null });
    } catch (error) {
      setState({ kind: 'refused', tool, message: friendlyMessage(error) });
    }
  };
  return { state, start: (tool) => void start(tool), dismiss: () => setState({ kind: 'idle' }) };
}

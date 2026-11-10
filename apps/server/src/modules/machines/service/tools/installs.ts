import { newId } from '@mwc/shared/ids';
import type { InstallableTool } from '@mwc/shared/machines';
import type { RunnerTools } from '@mwc/shared/runner-protocol';
import { type InstallOutcome, keepLine } from '../../rules/tools.ts';
import type { ToolInstallStatus } from '../../schemas/tools.ts';

/**
 * The installs this server process started (docs/machines.md, "Tools"), in memory: each one's state and output while
 * it runs and an hour after it ended (at most `INSTALLS_KEPT` ended ones), for the card to read. A restart forgets them;
 * the audit log keeps who installed what with which result.
 */

/** How long an ended install stays readable, and how many ended ones are kept at most. */
export const INSTALL_KEPT_MS = 60 * 60_000;
export const INSTALLS_KEPT = 100;

export interface ToolInstall {
  /** Also the `tools.install` frame's `cmdId`. */
  readonly id: string;
  readonly companyId: string;
  readonly machineId: string;
  readonly tool: InstallableTool;
  readonly version: string;
  /** Who started it. */
  readonly principalId: string;
  readonly startedAt: Date;
  status: ToolInstallStatus;
  readonly lines: string[];
  tools: RunnerTools | null;
  error: string | null;
  finishedAt: Date | null;
}

export type NewInstall = Pick<ToolInstall, 'companyId' | 'machineId' | 'tool' | 'version' | 'principalId'>;

/** The registry of one app's installs. */
export function toolInstalls(clock: () => Date) {
  const all = new Map<string, ToolInstall>();
  const prune = () => {
    const now = clock().getTime();
    const ended = [...all.values()].filter((install) => install.finishedAt !== null);
    ended.forEach((install, index) => {
      const old = now - (install.finishedAt as Date).getTime() > INSTALL_KEPT_MS;
      if (old || index < ended.length - INSTALLS_KEPT) all.delete(install.id);
    });
  };
  return {
    start(fields: NewInstall): ToolInstall {
      prune();
      const install: ToolInstall = {
        ...fields,
        id: newId(),
        startedAt: clock(),
        status: 'running',
        lines: [],
        tools: null,
        error: null,
        finishedAt: null,
      };
      all.set(install.id, install);
      return install;
    },
    /** A line it printed. */
    output(install: ToolInstall, line: string): void {
      keepLine(install.lines, line);
    },
    finish(install: ToolInstall, outcome: InstallOutcome): void {
      install.status = outcome.ok ? 'succeeded' : 'failed';
      install.tools = outcome.tools;
      install.error = outcome.error;
      install.finishedAt = clock();
    },
    /** An install of this company's machine, or undefined. */
    get(companyId: string, machineId: string, id: string): ToolInstall | undefined {
      prune();
      const install = all.get(id);
      return install?.companyId === companyId && install.machineId === machineId ? install : undefined;
    },
  };
}

export type ToolInstalls = ReturnType<typeof toolInstalls>;

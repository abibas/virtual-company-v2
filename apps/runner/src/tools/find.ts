import { MachineTool } from '@mwc/shared/machines';
import type { RunnerTools } from '@mwc/shared/runner-protocol';
import { type Host, homeOf } from '../install/host.ts';
import { findCli, pathWithCliDir } from '../system/find-cli.ts';
import type { HarnessClis } from '../turns/drivers.ts';

/**
 * The machine's CLIs (docs/machines.md, "Tools"): Claude Code, Codex, git, gh and Docker, each looked for as the
 * harnesses are (`system/find-cli.ts`: the PATH, then the usual folders, no process for that) and the found ones asked
 * `--version` once, side by side, by their full path with their folder first on the PATH. A CLI that is missing or does
 * not answer is null.
 */

/** A CLI as the runner found it: its full path and the first line its `--version` printed. */
export interface ToolCli {
  readonly path: string;
  readonly version: string;
}

/** What a search found: each CLI's version (`caps.tools`), and where the found ones are. */
export interface FoundTools {
  readonly versions: RunnerTools;
  readonly clis: Partial<Record<MachineTool, ToolCli>>;
}

/** The longest version the protocol takes (`ToolVersion`). */
const VERSION_MAX = 100;

/** The CLI `command` where its installer put it and the first line of its `--version`; undefined when missing or silent. */
export async function toolCli(host: Host, command: string): Promise<ToolCli | undefined> {
  const path = findCli(command, { path: host.env.PATH, home: homeOf(host), fs: host.fs });
  if (path === undefined) return undefined;
  const env = { ...host.env, PATH: pathWithCliDir(path, host.env.PATH) };
  const result = await host.exec(path, ['--version'], { env });
  const line = result.code === 0 ? result.stdout.trim().split('\n')[0]?.trim() : undefined;
  return line ? { path, version: line.slice(0, VERSION_MAX) } : undefined;
}

/** Every CLI of `MachineTool`, looked for and asked its version (no process for a missing one). */
export async function findTools(host: Host): Promise<FoundTools> {
  const found = await Promise.all(
    MachineTool.options.map(async (tool) => [tool, await toolCli(host, tool)] as const),
  );
  const versions = Object.fromEntries(found.map(([tool, cli]) => [tool, cli?.version ?? null]));
  const clis = Object.fromEntries(found.filter(([, cli]) => cli !== undefined));
  return { versions: versions as RunnerTools, clis };
}

/** The harnesses' CLIs among the tools found: Claude Code's `claude`, Codex's `codex`. */
export function harnessesOf(found: FoundTools): HarnessClis {
  const { claude, codex } = found.clis;
  return { ...(claude ? { claude_code: claude } : {}), ...(codex ? { codex } : {}) };
}

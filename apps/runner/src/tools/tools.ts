import type { Harness } from '@mwc/shared/enums';
import type {
  RunnerTools,
  ToolsCheck,
  ToolsInstall,
  ToolsOutput,
  ToolsResult,
} from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import type { KillGroup, Spawn } from '../system/process.ts';
import type { Timers } from '../system/time.ts';
import type { HarnessHost } from '../turns/turns.ts';
import type { FoundTools } from './find.ts';
import type { ToolsHost } from './host.ts';
import { npmInstallArgs, type RunningInstall, startNpmInstall } from './install.ts';

/**
 * The daemon's tools (docs/machines.md, "Tools"; docs/runner-protocol.md, "Tools"): the versions its hello says
 * (`caps.tools`), `tools.check` (look again) and `tools.install` (npm installs Claude Code or Codex into `~/.local`, one
 * at a time, never in a container), each answered by `tools.result` after the versions are read again. When they were
 * read again, the harnesses look again for a harness CLI found now (so a turn drives it and `caps.harnesses` says so)
 * and `changed` sends `runner.caps`, before the answer, so the server's view is fresh when it comes.
 */

export interface ToolsDeps {
  /** The search and what an install needs (`cli.ts`); without it no `caps.tools`, and every tools command is unsupported. */
  readonly host: ToolsHost | undefined;
  /** The versions the search found when the runner started. */
  readonly found: RunnerTools | undefined;
  /** How npm starts and is killed; without them nothing is installed. */
  readonly processes: { readonly spawn: Spawn; readonly killGroup: KillGroup } | undefined;
  /** The harnesses, told to look again for a harness CLI found now. */
  readonly harness: HarnessHost | undefined;
  readonly timers: Timers;
  readonly log: Log;
  /** An install's output line. */
  send(frame: ToolsOutput): boolean;
  /** The versions were read again: the daemon sends `runner.caps`. */
  changed(): void;
  /** How long npm may run; `TOOLS_INSTALL_TIMEOUT_MS` unless a test shortens it. */
  readonly installTimeoutMs?: number;
}

/** Each harness's CLI among the tools. */
const HARNESS_TOOLS = [
  ['claude', 'claude_code'],
  ['codex', 'codex'],
] as const satisfies readonly (readonly [keyof FoundTools['clis'], Harness])[];

export class Tools {
  readonly #deps: ToolsDeps;
  #found: RunnerTools | undefined;
  #installing: { readonly tool: string; readonly run: RunningInstall } | undefined;

  constructor(deps: ToolsDeps) {
    this.#deps = deps;
    this.#found = deps.found;
  }

  /**
   * The versions for `caps.tools`, with a harness CLI the harnesses found since (a turn looked again); undefined
   * without a search.
   */
  get current(): RunnerTools | undefined {
    const found = this.#found;
    if (found === undefined) return undefined;
    const versions = this.#deps.harness?.versions;
    return {
      ...found,
      claude: found.claude ?? versions?.claude_code ?? null,
      codex: found.codex ?? versions?.codex ?? null,
    };
  }

  /** The answer to `tools.check` or `tools.install` (it never throws). */
  handle(frame: ToolsCheck | ToolsInstall): Promise<ToolsResult> {
    return frame.type === 'tools.check' ? this.#check(frame) : this.#install(frame);
  }

  /** Kills an install under way (the runner stopping); its answer still follows. */
  stop(): void {
    this.#installing?.run.kill();
  }

  async #check(frame: ToolsCheck): Promise<ToolsResult> {
    const { host } = this.#deps;
    if (host === undefined) return this.#refuse(frame, 'unsupported: this runner does not report its tools');
    const tools = await this.#readAgain(host);
    return { type: 'tools.result', cmdId: frame.cmdId, ok: true, tools };
  }

  async #install(frame: ToolsInstall): Promise<ToolsResult> {
    const { host, processes } = this.#deps;
    if (host === undefined || processes === undefined) {
      return this.#refuse(frame, 'unsupported: this runner does not install tools');
    }
    if (host.container) {
      return this.#refuse(
        frame,
        'unsupported: a container gets its CLIs from its image; rebuild the image instead',
      );
    }
    if (this.#installing) return this.#refuse(frame, `busy: ${this.#installing.tool} is being installed`);
    const npm = host.npm();
    if (npm === undefined)
      return this.#refuse(frame, "npm_missing: there is no npm beside the runner's Node");
    const { cmdId, tool, version } = frame;
    const run = startNpmInstall(
      npm,
      npmInstallArgs(tool, version, host.home),
      { env: host.env, cwd: host.home },
      {
        ...processes,
        timers: this.#deps.timers,
        line: (line) => this.#deps.send({ type: 'tools.output', cmdId, line }),
        ...(this.#deps.installTimeoutMs === undefined ? {} : { timeoutMs: this.#deps.installTimeoutMs }),
      },
    );
    this.#installing = { tool, run };
    this.#deps.log.info('installing a tool', { tool, version });
    try {
      const end = await run.done;
      const tools = await this.#readAgain(host);
      this.#deps.log.info('tool install ended', { tool, version, ...end });
      const result: ToolsResult = { type: 'tools.result', cmdId, ok: end.ok, tools };
      return end.ok ? result : { ...result, error: end.error };
    } finally {
      this.#installing = undefined;
    }
  }

  /** Reads the versions again, has the harnesses look for a harness CLI found now, and reports the change. */
  async #readAgain(host: ToolsHost): Promise<RunnerTools> {
    const found = await host.find();
    this.#found = found.versions;
    const { harness } = this.#deps;
    const wanted = HARNESS_TOOLS.filter(([tool]) => found.clis[tool] !== undefined);
    await Promise.all(wanted.map(([, name]) => harness?.findAgain?.(name)));
    this.#deps.log.info('tools', { ...found.versions });
    this.#deps.changed();
    return this.current as RunnerTools;
  }

  #refuse(frame: ToolsCheck | ToolsInstall, error: string): ToolsResult {
    const tools = this.current;
    return { type: 'tools.result', cmdId: frame.cmdId, ok: false, error, ...(tools ? { tools } : {}) };
  }
}

import type { ProcessSpec } from '@mwc/harness-core';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import { ArtifactCollector } from './artifacts/collect.ts';
import { knownTools } from './ask/agent-tools.ts';
import { type AskBridge, turnTools } from './ask/bridge.ts';
import { serverToolsFile } from './ask/server-tools.ts';
import { processEnv } from './env.ts';
import { type PrivateLease, withPrivateDir } from './private-dir.ts';
import { RunFolder } from './runs/folder.ts';
import type { KeeperCommand } from './runs/kept.ts';
import type { FoundRun } from './runs/reattach.ts';
import type { TurnLaunch, TurnParts } from './turn.ts';
import type { HarnessHost } from './turns.ts';

/**
 * What a turn runs with (`turns.ts`): a fresh one's driver spec, run folder, private folder, environment, parser,
 * question socket (with the agents' tools the spec names that this runner knows, S6a, and the server's own it carries,
 * S7.1c, written to the turn's folder) and outputs folder, built after
 * the checks; a turn found on the disk at start (S5.4) takes its
 * driver's parser (from the turn's own start), its private folder adopted, its question socket listening again and its
 * outputs folder as its run folder noted it.
 */

/** A start refused: the code and words, or what starts it. */
export type Prepared =
  | { readonly refused: string }
  | { readonly parts: TurnParts; readonly launch: TurnLaunch };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The turn's question socket, when the runner offers its tools; a turn whose socket cannot open runs without it. */
function openBridge(host: HarnessHost, turnId: string, log: Log): AskBridge | undefined {
  if (host.ask === undefined) return undefined;
  try {
    return host.ask.open();
  } catch (error) {
    log.warn('this turn runs without the question tool', { turnId, error: messageOf(error) });
    return undefined;
  }
}

/** A task step's outputs folder, made and noted before the process; none without one (or when it cannot be used). */
function openArtifacts(host: HarnessHost, frame: TurnStart, log: Log): ArtifactCollector | undefined {
  const dir = frame.spec.artifacts?.dir;
  if (dir === undefined || host.artifacts === undefined) return undefined;
  return ArtifactCollector.open(host.artifacts, frame.spec.cwd, dir, log);
}

/**
 * A fresh turn, once the runner's own checks passed (it runs harnesses, has a slot, the keeper): the agent's folder,
 * the driver's spec, the run folder and private folder, then the environment, the parser and the outputs folder.
 */
export function prepareTurn(
  host: HarnessHost,
  keeper: KeeperCommand,
  frame: TurnStart,
  now: number,
  log: Log,
): Prepared {
  const { spec, turnId } = frame;
  const driver = host.drivers[spec.harness];
  if (driver === undefined) return { refused: 'unsupported' };
  if (!host.isDirectory(spec.cwd)) return { refused: 'home_missing' };
  const bridge = openBridge(host, turnId, log);
  const serverTools = spec.serverTools ?? [];
  let built: ProcessSpec;
  try {
    built = driver.turn(
      spec,
      bridge && host.ask && turnTools(host.ask, bridge, knownTools(spec.tools ?? []), serverTools),
    );
  } catch (error) {
    bridge?.close();
    return { refused: `invalid_spec: ${messageOf(error)}` };
  }
  let lease: PrivateLease | undefined;
  let folder: RunFolder | undefined;
  try {
    folder = RunFolder.create(host.runs, turnId);
    const files = [
      ...(built.turnFiles ?? []),
      ...(serverTools.length > 0 ? [serverToolsFile(serverTools)] : []),
    ];
    for (const file of files) bridge?.write(file);
    lease = built.privateDir && host.dirs.acquire(built.privateDir, spec.harness, spec.cwd);
  } catch (error) {
    bridge?.close();
    folder?.remove();
    return { refused: `spawn_failed: ${messageOf(error)}` };
  }
  const { process, env: extra } = withPrivateDir(built, lease);
  const env = processEnv(host.env, process, extra);
  const stdinOpen = process.stdinOpen === true && driver.inputLine !== undefined;
  const inputLine = stdinOpen ? driver.inputLine?.bind(driver) : undefined;
  const parser = driver.parser(
    lease === undefined ? { startedAt: now } : { privateDir: lease.path, startedAt: now },
  );
  const artifacts = openArtifacts(host, frame, log);
  const { harness, cwd } = spec;
  const sessionMissing = driver.sessionMissing?.bind(driver);
  return {
    parts: { folder, harness, cwd, parser, lease, bridge, inputLine, stdinOpen, artifacts, sessionMissing },
    launch: { process, env, keeper, startedAt: now, afterSeq: frame.afterSeq },
  };
}

/** A taken-back turn's question socket, listening again; without it the agent's questions are not shown. */
function reopenBridge(host: HarnessHost, run: FoundRun, log: Log): AskBridge | undefined {
  const { ask, turnId } = run.meta;
  if (run.kept === undefined || ask === null || host.ask === undefined) return undefined;
  try {
    return host.ask.reopen(ask.dir, ask.tokenSha256);
  } catch (error) {
    log.warn('this turn goes on without the question tool', { turnId, error: messageOf(error) });
    return undefined;
  }
}

/** What a turn found on the disk runs with; undefined when this runner no longer has its harness. */
export function takeBackParts(host: HarnessHost, run: FoundRun, log: Log): TurnParts | undefined {
  const { meta, folder } = run;
  const driver = host.drivers[meta.harness];
  if (driver === undefined) return undefined;
  const { privateDir, startedAt } = meta;
  const lease =
    privateDir === null ? undefined : host.dirs.adopt(privateDir.path, privateDir.files, privateDir.aside);
  const parser = driver.parser(
    privateDir === null ? { startedAt } : { privateDir: privateDir.path, startedAt },
  );
  const artifacts =
    meta.artifacts && host.artifacts ? ArtifactCollector.restore(host.artifacts, meta.artifacts) : undefined;
  const inputLine = meta.stdinOpen ? driver.inputLine?.bind(driver) : undefined;
  const bridge = reopenBridge(host, run, log);
  const { harness, cwd, stdinOpen } = meta;
  const sessionMissing = driver.sessionMissing?.bind(driver);
  return { folder, harness, cwd, parser, lease, bridge, inputLine, stdinOpen, artifacts, sessionMissing };
}

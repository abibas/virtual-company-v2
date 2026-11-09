import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { WebSocket } from 'ws';
import { nodeFoldersFs } from '../folders/files.ts';
import { detectPowerExecutor } from '../power/detect.ts';
import { loadPty } from '../terminal/loader.ts';
import { nodePrivateFs } from '../turns/files.ts';
import type { MainDeps } from './deps.ts';
import { SYSTEM_CLOCK, SYSTEM_TIMERS } from './time.ts';
import { runnerBuiltAt, runnerVersion } from './version.ts';

/** The real process behind `main` (`main.ts`): Node's own modules, `ws`, the environment and the signals. */

/** The runner's version, from its package.json (read once at start). */
export function readRunnerVersion(packageJson: URL = new URL('../../package.json', import.meta.url)): string {
  const { version } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown };
  if (typeof version !== 'string' || version === '')
    throw new Error(`${packageJson.pathname} has no version`);
  return version;
}

export function nodeDeps(): MainDeps {
  return {
    env: process.env,
    platform: process.platform,
    pid: process.pid,
    os,
    fs: {
      exists: (path) => existsSync(path),
      readFile: (path) => readFile(path, 'utf8'),
      statfs: (path) => statfs(path),
      mkdir: (path) => {
        mkdirSync(path, { recursive: true, mode: 0o700 });
      },
    },
    privateFs: nodePrivateFs(),
    foldersFs: nodeFoldersFs(),
    spawn,
    killGroup: (pid, signal) => {
      try {
        process.kill(-pid, signal);
      } catch {
        // The group is gone already.
      }
    },
    WebSocket,
    clock: SYSTEM_CLOCK,
    timers: SYSTEM_TIMERS,
    random: Math.random,
    write: (line) => {
      process.stdout.write(line);
    },
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
    exit: process.exit.bind(process),
    keepAlive: () => {
      const timer = setInterval(() => {}, 2 ** 30);
      return () => clearInterval(timer);
    },
    version: runnerVersion(readRunnerVersion),
    builtAt: runnerBuiltAt(),
    // A power controller when the airia CLI and gcloud are installed here (found without starting a process).
    power: detectPowerExecutor({ env: process.env, home: os.homedir(), exists: existsSync }),
    // The PTY next to the bundle (node_modules/ beside runner.mjs), or the package's own from the sources.
    loadPty: () =>
      loadPty({ platform: process.platform, arch: process.arch, load: createRequire(import.meta.url) }),
  };
}

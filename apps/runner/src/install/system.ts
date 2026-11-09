import { execFile } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { readRunnerVersion } from '../system/node.ts';
import { runnerVersion } from '../system/version.ts';
import type { ExecResult, Host, HostFs } from './host.ts';

/** The real machine behind the runner's own commands (`main.ts`): Node's modules, the process and its output. */

/** How long one command may run (a service manager's, `claude --version`). */
export const EXEC_TIMEOUT_MS = 30_000;

/** The files, through Node's synchronous `fs`. */
export const nodeFs: HostFs = {
  exists: (path) => existsSync(path),
  isExecutable: (path) => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
  readBytes: (path) => readFileSync(path),
  writeFile: (path, text, mode) => {
    writeFileSync(path, text, { mode });
    chmodSync(path, mode);
  },
  writeBytes: (path, bytes, mode) => {
    writeFileSync(path, bytes, { mode, flag: 'wx' });
    chmodSync(path, mode);
  },
  rename: (from, to) => renameSync(from, to),
  copyFile: (from, to) => {
    copyFileSync(from, to);
    chmodSync(to, 0o644);
  },
  copyTree: (from, to) => cpSync(from, to, { recursive: true }),
  mkdir: (path, mode) => {
    mkdirSync(path, { recursive: true, mode });
  },
  remove: (path) => rmSync(path, { recursive: true, force: true }),
};

/** Runs a program to its end (killed after `EXEC_TIMEOUT_MS`) and collects its output; never throws. */
export function nodeExec(
  file: string,
  args: readonly string[],
  options: { env?: Readonly<Record<string, string | undefined>> } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env: { ...(options.env ?? process.env) }, timeout: EXEC_TIMEOUT_MS, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr });
        const code = typeof error.code === 'number' ? error.code : null;
        resolve(code === null ? { code, stdout, stderr, error: error.message } : { code, stdout, stderr });
      },
    );
  });
}

export function nodeHost(): Host {
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    selfPath: String(process.argv[1]),
    uid: process.getuid?.() ?? 0,
    version: runnerVersion(readRunnerVersion),
    hostname: () => os.hostname(),
    homedir: () => os.homedir(),
    username: () => os.userInfo().username,
    fs: nodeFs,
    exec: nodeExec,
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
    },
  };
}

import { spawn } from 'node:child_process';
import { closeSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { SYSTEM_TIMERS } from '../../system/time.ts';
import type { KeeperIo } from './keeper.ts';

/**
 * The keeper's real process (`runKeeper`'s `KeeperIo`): Node's `spawn` (no shell, the keeper's own environment and
 * folder, which the runner set), files opened for appending, a Unix socket server, and its own stdin and signals.
 * `overrides` replaces parts (tests drive the keeper in-process with their own stdin and signals).
 */
export function nodeKeeperIo(argv: readonly string[], overrides: Partial<KeeperIo> = {}): KeeperIo {
  return {
    argv,
    pid: process.pid,
    stdin: process.stdin,
    spawn: (command, args, out, err) => spawn(command, [...args], { stdio: ['pipe', out, err] }),
    openAppend: (path) => openSync(path, 'a', 0o600),
    close: (fd) => closeSync(fd),
    listen: (path, connected) => {
      rmSync(path, { force: true });
      const server = createServer((socket) => connected(socket));
      // Without its socket the turn runs on; it just cannot be taken back after a runner restart.
      server.on('error', () => {});
      server.listen(path);
      return { close: () => server.close() };
    },
    writeFile: (path, text) => {
      const temp = `${path}.tmp`;
      writeFileSync(temp, text, { mode: 0o600 });
      renameSync(temp, path);
    },
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
    timers: SYSTEM_TIMERS,
    ...overrides,
  };
}

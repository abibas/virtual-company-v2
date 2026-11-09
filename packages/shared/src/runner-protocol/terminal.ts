import { z } from 'zod';
import { CodexAuthJson, TerminalSpec } from '../harness.ts';
import { ErrorText, frame, Uuid } from './common.ts';

/**
 * The machine terminal (docs/machines.md, "Terminal"; S4, 2026-11-09): a shell on a machine, opened by its runner in a
 * pseudo-terminal and carried over the runner's link, which the server relays to an owner's browser socket
 * (`TERMINAL_WS_PATH`). The runner frames of both directions, and the browser socket's messages, which the relay maps
 * one to one. Terminal bytes travel as base64 (`TerminalData`), so a frame never splits a character's bytes wrongly.
 */

/** The browser's socket: `GET /api/terminal/ws?ticket=…&cols=…&rows=…`, opened with a one-time ticket. */
export const TERMINAL_WS_PATH = '/api/terminal/ws';

/** The most bytes (decoded) one `terminal.input` or `terminal.output` carries. */
export const TERMINAL_DATA_MAX_BYTES = 64 * 1024;

/** The terminal's size: columns and rows. */
export const TERMINAL_COLS = { min: 2, max: 500 } as const;
export const TERMINAL_ROWS = { min: 1, max: 300 } as const;

/** The most terminals open at once on one machine. */
export const TERMINAL_SESSIONS_MAX = 4;

/** A terminal closes this long after its last input (with a notice line first). */
export const TERMINAL_IDLE_MS = 60 * 60_000;

/** How long a terminal ticket opens the browser socket, once. */
export const TERMINAL_TICKET_TTL_MS = 60_000;

export const TerminalCols = z.int().min(TERMINAL_COLS.min).max(TERMINAL_COLS.max);
export const TerminalRows = z.int().min(TERMINAL_ROWS.min).max(TERMINAL_ROWS.max);

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The longest base64 text of `TERMINAL_DATA_MAX_BYTES` bytes. */
const DATA_MAX_LENGTH = Math.ceil(TERMINAL_DATA_MAX_BYTES / 3) * 4;

/** How many bytes a padded base64 text decodes to. */
export function base64Bytes(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

/** Raw terminal bytes as padded base64: 1 to `TERMINAL_DATA_MAX_BYTES` bytes. */
export const TerminalData = z
  .string()
  .min(1)
  .max(DATA_MAX_LENGTH)
  .regex(BASE64, 'padded base64')
  .refine((text) => base64Bytes(text) <= TERMINAL_DATA_MAX_BYTES, {
    message: `at most ${TERMINAL_DATA_MAX_BYTES} bytes`,
  });

/**
 * Server to runner: open a shell in a new pseudo-terminal of this size (`sessionId` is the server's); with `harness`
 * (a chat's terminal, S5.1b), the harness's own TUI on the chat's conversation, in the agent's folder, with the
 * credential the server resolved, instead of a login shell. A runner older than chats ignores `harness` and opens a
 * shell, so the server sends it only to a runner that has the harness.
 */
export const TerminalOpen = frame('terminal.open', {
  sessionId: Uuid,
  cols: TerminalCols,
  rows: TerminalRows,
  harness: TerminalSpec.optional(),
});
export type TerminalOpen = z.infer<typeof TerminalOpen>;

/** Server to runner: what the person typed or pasted, as raw bytes. */
export const TerminalInput = frame('terminal.input', {
  sessionId: Uuid,
  data: TerminalData,
});
export type TerminalInput = z.infer<typeof TerminalInput>;

export const TerminalResize = frame('terminal.resize', {
  sessionId: Uuid,
  cols: TerminalCols,
  rows: TerminalRows,
});
export type TerminalResize = z.infer<typeof TerminalResize>;

/** Server to runner: end the session (SIGHUP to the shell, SIGKILL 5 s later); `terminal.exit` follows. */
export const TerminalClose = frame('terminal.close', {
  sessionId: Uuid,
});
export type TerminalClose = z.infer<typeof TerminalClose>;

/** Runner to server: the shell started (its path). */
export const TerminalOpened = frame('terminal.opened', {
  sessionId: Uuid,
  shell: z.string().min(1).max(4096),
});
export type TerminalOpened = z.infer<typeof TerminalOpened>;

/** Runner to server: what the terminal printed, batched (about 16 ms or 32 KB). */
export const TerminalOutput = frame('terminal.output', {
  sessionId: Uuid,
  data: TerminalData,
});
export type TerminalOutput = z.infer<typeof TerminalOutput>;

/**
 * How a terminal ended: the shell's exit code, or null with the signal that ended it (`SIGHUP`), and why the runner or
 * the server ended it, when one did (`error`: a code such as `idle_timeout` or `too_many_sessions`, optionally followed
 * by `: ` and words).
 */
export const TerminalEnd = {
  code: z.int().nullable(),
  signal: z.string().min(1).max(32).optional(),
  error: ErrorText.optional(),
};

/**
 * Runner to server: the session ended (the shell exited, or it never started); nothing follows for it. A harness's
 * terminal adds the Codex login its process rewrote (`authJson`, never relayed to the browser), for the server to seal
 * again.
 */
export const TerminalExit = frame('terminal.exit', {
  sessionId: Uuid,
  ...TerminalEnd,
  authJson: CodexAuthJson.optional(),
});
export type TerminalExit = z.infer<typeof TerminalExit>;

/** The terminal frames the server sends. */
export const TERMINAL_SERVER_FRAMES = [TerminalOpen, TerminalInput, TerminalResize, TerminalClose] as const;
export type TerminalServerFrame = TerminalOpen | TerminalInput | TerminalResize | TerminalClose;

/** The terminal frames a runner sends. */
export const TERMINAL_RUNNER_FRAMES = [TerminalOpened, TerminalOutput, TerminalExit] as const;
export type TerminalRunnerFrame = TerminalOpened | TerminalOutput | TerminalExit;

/** True for a frame of the terminal (`terminal.*`), of either direction. */
export function isTerminalFrame<F extends { readonly type: string }>(
  frame: F,
): frame is Extract<F, TerminalServerFrame | TerminalRunnerFrame> {
  return frame.type.startsWith('terminal.');
}

/**
 * The browser socket's messages (JSON text), browser to server: what xterm.js gives (`input`, UTF-8 text) and the
 * terminal's new size (`resize`). A message is at most 256 KB; the server splits input into frames of
 * `TERMINAL_DATA_MAX_BYTES`.
 */
export const TerminalToServer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().min(1) }),
  z.object({ type: z.literal('resize'), cols: TerminalCols, rows: TerminalRows }),
]);
export type TerminalToServer = z.infer<typeof TerminalToServer>;

/**
 * Server to browser: the shell started, what it printed (base64 of the raw bytes), how it ended (the socket then
 * closes with 1000), or why the server could not open it (`error`, then the close).
 */
export const TerminalToBrowser = z.discriminatedUnion('type', [
  z.object({ type: z.literal('opened'), shell: z.string() }),
  z.object({ type: z.literal('output'), data: z.string() }),
  z.object({ type: z.literal('exit'), ...TerminalEnd }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type TerminalToBrowser = z.infer<typeof TerminalToBrowser>;

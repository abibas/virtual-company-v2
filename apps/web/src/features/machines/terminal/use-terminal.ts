import {
  TERMINAL_COLS,
  TERMINAL_ROWS,
  type TerminalToBrowser,
  type TerminalToServer,
} from '@mwc/shared/runner-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { closedText, exitText, reasonText, ticketErrorText } from './terminal-text.ts';

/**
 * A terminal session (docs/machines.md, "Terminal"): an owner's one-time ticket (a machine's shell, or a chat's harness
 * TUI, S5.1c), then the browser socket on this page's own origin (`ws(s)://<host>/api/terminal/ws`; Vite's `/api` proxy
 * forwards WebSockets in development, the server serves the page in production), so the `Origin` is the web origin the
 * server checks.
 */

/** A one-time ticket for the terminal socket, as `POST …/terminal-tickets` answers it. */
export interface TerminalTicket {
  readonly ticket: string;
  readonly wsPath: string;
}

/** Asks for a new ticket: the machine's (`machineCalls().terminalTicket`) or a chat's (`chatCalls().terminalTicket`). */
export type TicketSource = () => Promise<TerminalTicket>;

export type TerminalStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected'; readonly shell: string }
  | { readonly kind: 'ended'; readonly reason: string; readonly failed: boolean };

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalSession {
  readonly status: TerminalStatus;
  /** Closes any open socket and opens a new terminal (a new ticket) at this size. */
  open(size: TerminalSize): void;
  /** Keystrokes as xterm.js gives them; nothing unless the socket is open. */
  send(data: string): void;
  resize(size: TerminalSize): void;
  /** Closes the socket, which ends the shell on the machine. */
  close(): void;
}

/** Input is sent in pieces well under the socket's 256 KB message limit (a long paste). */
const INPUT_CHUNK = 16_384;

const clamp = (value: number, { min, max }: { readonly min: number; readonly max: number }) =>
  Math.min(max, Math.max(min, Math.floor(value) || min));

const clampSize = (size: TerminalSize): TerminalSize => ({
  cols: clamp(size.cols, TERMINAL_COLS),
  rows: clamp(size.rows, TERMINAL_ROWS),
});

function socketUrl(wsPath: string, ticket: string, size: TerminalSize): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams({ ticket, cols: String(size.cols), rows: String(size.rows) });
  return `${scheme}//${window.location.host}${wsPath}?${query}`;
}

/** The raw bytes of an `output` message, so a character split across messages stays whole in xterm. */
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function parseMessage(data: unknown): TerminalToBrowser | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data) as TerminalToBrowser;
  } catch {
    return undefined;
  }
}

interface Listener {
  /** False once this socket is no longer the session's (closed, or replaced by a reconnect). */
  readonly current: () => boolean;
  readonly setStatus: (status: TerminalStatus) => void;
  readonly onOutput: (bytes: Uint8Array) => void;
  readonly onClose: () => void;
}

/** The socket's messages as the session's status and output; the first end wins, and a stale socket says nothing. */
function listen(ws: WebSocket, to: Listener) {
  let opened = false;
  let ended = false;
  const end = (reason: string, failed: boolean) => {
    if (ended || !to.current()) return;
    ended = true;
    to.setStatus({ kind: 'ended', reason, failed });
  };
  ws.onmessage = (event: MessageEvent) => {
    const message = to.current() ? parseMessage(event.data) : undefined;
    if (message?.type === 'opened') {
      opened = true;
      to.setStatus({ kind: 'connected', shell: message.shell });
    } else if (message?.type === 'output') {
      to.onOutput(decodeBase64(message.data));
    } else if (message?.type === 'exit') {
      const { reason, failed } = exitText(message);
      end(reason, failed);
    } else if (message?.type === 'error' && message.code !== 'invalid_message') {
      end(reasonText(message.code), true);
    }
  };
  ws.onclose = () => {
    to.onClose();
    end(closedText(opened), true);
  };
}

/**
 * The ticket and the socket of one terminal at a time; `getTicket` asks for each new ticket, `onOutput` gets the shell's
 * bytes, and `describeError` words a refused ticket (the machine terminal's words by default).
 */
export function useTerminalSession(
  getTicket: TicketSource,
  onOutput: (bytes: Uint8Array) => void,
  describeError: (error: unknown) => string = ticketErrorText,
): TerminalSession {
  const tickets = useRef(getTicket);
  tickets.current = getTicket;
  const describe = useRef(describeError);
  describe.current = describeError;
  const output = useRef(onOutput);
  output.current = onOutput;
  const socket = useRef<WebSocket | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<TerminalStatus>({ kind: 'idle' });

  const close = useCallback(() => {
    generation.current += 1;
    const open = socket.current;
    socket.current = null;
    open?.close(1000);
  }, []);

  const open = useCallback(
    (size: TerminalSize) => {
      close();
      const mine = generation.current;
      const current = () => generation.current === mine;
      setStatus({ kind: 'connecting' });
      void (async () => {
        try {
          const { ticket, wsPath } = await tickets.current();
          if (!current()) return;
          const ws = new WebSocket(socketUrl(wsPath, ticket, clampSize(size)));
          socket.current = ws;
          listen(ws, {
            current,
            setStatus,
            onOutput: (bytes) => output.current(bytes),
            onClose: () => {
              if (socket.current === ws) socket.current = null;
            },
          });
        } catch (error) {
          if (current()) setStatus({ kind: 'ended', reason: describe.current(error), failed: true });
        }
      })();
    },
    [close],
  );

  const sendMessage = useCallback((message: TerminalToServer) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const send = useCallback(
    (data: string) => {
      let start = 0;
      while (start < data.length) {
        let end = Math.min(data.length, start + INPUT_CHUNK);
        // Never between the two halves of a surrogate pair (an emoji at the cut).
        if (end < data.length && /[\uD800-\uDBFF]/.test(data.charAt(end - 1))) end -= 1;
        sendMessage({ type: 'input', data: data.slice(start, end) });
        start = end;
      }
    },
    [sendMessage],
  );

  const resize = useCallback(
    (size: TerminalSize) => sendMessage({ type: 'resize', ...clampSize(size) }),
    [sendMessage],
  );

  useEffect(() => close, [close]);

  return { status, open, send, resize, close };
}

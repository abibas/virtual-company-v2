import {
  TERMINAL_DATA_MAX_BYTES,
  type TerminalToBrowser,
  TerminalToServer,
} from '@mwc/shared/runner-protocol';
import type { SocketHandlers, SocketLink } from '../../../../platform/realtime/sockets.ts';
import type { RunnerHub, TerminalRequest } from '../runner/hub.ts';

/**
 * The browser's terminal socket, relayed to the machine's runner through the hub (docs/machines.md, "Terminal"). On
 * open it sends `terminal.open`; the runner's frames come back as JSON messages (`opened`, `output` in base64, `exit`),
 * the browser's typed text (`input`, UTF-8) goes to the runner as base64 frames of at most 64 KB, and `resize` follows.
 * The terminal's end closes the socket (1000, after the `exit`; a Codex login a chat's terminal rewrote goes to
 * `rewrote`, never to the browser); closing the socket ends the terminal (`terminal.close`). A machine whose runner went away or has no terminal is an `error` message, then the close.
 */

/** The close code after a terminal's `exit` or an `error`: the message says why. */
export const TERMINAL_SOCKET_DONE = 1000;

/**
 * The terminal a socket opens: on which machine of which company, its session and size; for a chat's terminal also the
 * harness's spec (`harness`) and where a Codex login its process rewrote goes (`rewrote`, the chats module seals it).
 */
export interface RelayTarget extends TerminalRequest {
  readonly companyId: string;
  readonly machineId: string;
  readonly rewrote?: (authJson: string) => void;
}

/** UTF-8 text as base64 pieces of at most `TERMINAL_DATA_MAX_BYTES` bytes each. */
export function inputPieces(text: string): string[] {
  const bytes = Buffer.from(text, 'utf8');
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += TERMINAL_DATA_MAX_BYTES) {
    pieces.push(bytes.subarray(offset, offset + TERMINAL_DATA_MAX_BYTES).toString('base64'));
  }
  return pieces;
}

const OFFLINE: TerminalToBrowser = {
  type: 'error',
  code: 'machine_offline',
  message: "The machine's runner is not connected",
};
const UNAVAILABLE: TerminalToBrowser = {
  type: 'error',
  code: 'terminal_unavailable',
  message: "The machine's runner has no terminal",
};

/** A browser message, or why it is not one. */
function read(text: string): TerminalToServer | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'A message is JSON';
  }
  const parsed = TerminalToServer.safeParse(value);
  return parsed.success ? parsed.data : 'A message is {type:"input", data} or {type:"resize", cols, rows}';
}

/** Opens the terminal for a browser socket that just opened, and returns what handles the socket. */
export function openRelay(hub: RunnerHub, link: SocketLink, target: RelayTarget): SocketHandlers {
  let ended = false;
  const send = (message: TerminalToBrowser) => link.send(JSON.stringify(message));
  /** Called once: after an end the board forgets the session, and a closed socket's session was closed first. */
  const end = (message: TerminalToBrowser) => {
    ended = true;
    send(message);
    link.close(TERMINAL_SOCKET_DONE, message.type === 'exit' ? 'The terminal ended' : 'No terminal');
  };
  const { companyId, machineId, sessionId, cols, rows, harness } = target;
  const ours = hub.connected(machineId)?.companyId === companyId;
  const request = { sessionId, cols, rows, ...(harness === undefined ? {} : { harness }) };
  const channel = ours
    ? hub.terminal(machineId, request, {
        opened: (shell) => send({ type: 'opened', shell }),
        output: (data) => send({ type: 'output', data }),
        exit: ({ authJson, ...ending }) => {
          if (authJson !== undefined) target.rewrote?.(authJson);
          end({ type: 'exit', ...ending });
        },
      })
    : undefined;
  if (channel === undefined) end(ours ? UNAVAILABLE : OFFLINE);
  return {
    message(text) {
      if (ended || channel === undefined) return;
      const message = read(text);
      if (typeof message === 'string') send({ type: 'error', code: 'invalid_message', message });
      else if (message.type === 'resize') channel.resize(message.cols, message.rows);
      else for (const piece of inputPieces(message.data)) channel.input(piece);
    },
    closed() {
      if (ended) return;
      ended = true;
      channel?.close();
    },
  };
}

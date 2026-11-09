/**
 * The terminal tests' helpers: an owner's ticket through the API, and a browser's socket (a real `ws` client with the
 * web origin) that keeps every message, waits for the next one of a type, and tells how it closed or why its upgrade
 * was refused.
 */
import { TERMINAL_WS_PATH, type TerminalToBrowser } from '@mwc/shared/runner-protocol';
import { WebSocket } from 'ws';
import type { TerminalTicketView } from '../../../src/modules/machines/schemas/terminal.ts';
import { as, type MembersCompany } from '../members/members.ts';
import { type Person, WEB_ORIGIN } from '../platform/auth.ts';
import { eventually } from '../platform/realtime.ts';
import { machinesPath } from './machines.ts';
import type { MachinesWorld } from './world.ts';

/** POST terminal-tickets as `person` (the owner by default): the status and the body. */
export async function askTicket(
  w: MachinesWorld,
  company: MembersCompany,
  machineId: string,
  person: Person = company.owner,
) {
  return as(w, person)('POST', machinesPath(company, `/${machineId}/terminal-tickets`));
}

/** A ticket for the owner, or the test fails. */
export async function ticketFor(
  w: MachinesWorld,
  company: MembersCompany,
  machineId: string,
): Promise<string> {
  const res = await askTicket(w, company, machineId);
  if (res.status !== 201)
    throw new Error(`POST terminal-tickets answered ${res.status}: ${JSON.stringify(res.body)}`);
  return (res.body as TerminalTicketView).ticket;
}

/** The browser socket's address for a ticket and a size. */
export function terminalUrl(w: MachinesWorld, query: Record<string, string | number>): string {
  const base = w.url.replace(/\/api\/runner\/ws$/, TERMINAL_WS_PATH);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return `${base}?${params}`;
}

export interface BrowserSocket {
  readonly socket: WebSocket;
  readonly messages: TerminalToBrowser[];
  /** How it closed, once it does. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  /** The first message of `type` (already received or still to come). */
  next<T extends TerminalToBrowser['type']>(type: T): Promise<Extract<TerminalToBrowser, { type: T }>>;
  send(message: unknown): void;
}

/** Opens the browser's socket (the web origin unless told otherwise); rejects with the status of a refused upgrade. */
export function openTerminal(url: string, origin: string | null = WEB_ORIGIN): Promise<BrowserSocket> {
  const socket = new WebSocket(url, origin === null ? {} : { origin });
  const messages: TerminalToBrowser[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(String(data)) as TerminalToBrowser));
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: String(reason) }));
  });
  const next = async <T extends TerminalToBrowser['type']>(type: T) => {
    await eventually(`a ${type} message`, () => messages.some((message) => message.type === type));
    return messages.find((message) => message.type === type) as Extract<TerminalToBrowser, { type: T }>;
  };
  return new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`refused: ${response.statusCode}`));
      socket.terminate();
    });
    socket.on('error', () => {});
    socket.once('open', () =>
      resolve({ socket, messages, closed, next, send: (message) => socket.send(JSON.stringify(message)) }),
    );
  });
}

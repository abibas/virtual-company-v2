import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import {
  TERMINAL_DATA_MAX_BYTES,
  TERMINAL_TICKET_TTL_MS,
  TERMINAL_WS_PATH,
} from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enroll } from '../../../fixtures/machines/machines.ts';
import { askTicket, openTerminal, terminalUrl, ticketFor } from '../../../fixtures/machines/terminal.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { addMember, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** A company with a machine whose runner is connected, with a terminal unless told otherwise. */
async function onlineMachine(terminal = true) {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company);
  const runner = await w.connect(runnerKey, { caps: { terminal } });
  return { company, machineId, runner, runnerKey };
}

/** The browser's socket on a fresh ticket, and the `terminal.open` its runner got. */
async function openedTerminal(
  company: MembersCompany,
  machineId: string,
  runner: Awaited<ReturnType<typeof onlineMachine>>['runner'],
) {
  const ticket = await ticketFor(w, company, machineId);
  const browser = await openTerminal(terminalUrl(w, { ticket, cols: 100, rows: 30 }));
  const open = await runner.frames.next('terminal.open');
  return { browser, open, sessionId: open.sessionId };
}

describe('POST machines/:machineId/terminal-tickets', () => {
  it('gives an owner a one-time ticket for 60 s, uncached, with the socket path', async () => {
    const { company, machineId } = await onlineMachine();
    const res = await askTicket(w, company, machineId);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      ticket: expect.stringMatching(/^mwc_tt_[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date(new Date(TEST_NOW).getTime() + TERMINAL_TICKET_TTL_MS).toISOString(),
      wsPath: TERMINAL_WS_PATH,
    });
  });

  it('is for owners only: admins, members and viewers get 403', async () => {
    const { company, machineId } = await onlineMachine();
    for (const role of ['admin', 'member', 'viewer'] as const) {
      const person = await addMember(w, company, role);
      expect((await askTicket(w, company, machineId, person)).status).toBe(403);
    }
  });

  it("is a 404 for another company's machine and an unknown one", async () => {
    const { machineId } = await onlineMachine();
    const other = await membersCompany(w);
    expect((await askTicket(w, other, machineId)).body).toMatchObject({
      error: { code: 'machine_not_found' },
    });
    expect((await askTicket(w, other, 'nope')).status).toBe(404);
  });

  it('is a 409 for a machine whose runner is offline or has no terminal', async () => {
    const company = await membersCompany(w);
    const { machineId } = await enroll(w, company);
    const offline = await askTicket(w, company, machineId);
    expect([offline.status, offline.body]).toMatchObject([409, { error: { code: 'machine_offline' } }]);
    const bare = await onlineMachine(false);
    const unavailable = await askTicket(w, bare.company, bare.machineId);
    expect([unavailable.status, unavailable.body]).toMatchObject([
      409,
      { error: { code: 'terminal_unavailable' } },
    ]);
  });
});

describe('GET /api/terminal/ws', () => {
  it('opens the terminal on the runner and relays both ways, then closes with its exit', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const { browser, open, sessionId } = await openedTerminal(company, machineId, runner);
    expect(open).toEqual({ type: 'terminal.open', sessionId, cols: 100, rows: 30 });
    runner.send({ type: 'terminal.opened', sessionId, shell: '/bin/zsh' });
    expect(await browser.next('opened')).toEqual({ type: 'opened', shell: '/bin/zsh' });
    const printed = Buffer.from('ihor@mac ~ % ').toString('base64');
    runner.send({ type: 'terminal.output', sessionId, data: printed });
    expect(await browser.next('output')).toEqual({ type: 'output', data: printed });
    browser.send({ type: 'input', data: 'ls ü\r' });
    const input = await runner.frames.next('terminal.input');
    expect(Buffer.from(input.data, 'base64').toString()).toBe('ls ü\r');
    browser.send({ type: 'resize', cols: 120, rows: 40 });
    expect(await runner.frames.next('terminal.resize')).toEqual({
      type: 'terminal.resize',
      sessionId,
      cols: 120,
      rows: 40,
    });
    runner.send({ type: 'terminal.exit', sessionId, code: 0 });
    expect(await browser.next('exit')).toEqual({ type: 'exit', code: 0 });
    expect(await browser.closed).toEqual({ code: 1000, reason: 'The terminal ended' });
  });

  it('records each terminal opened in the audit log: who, which machine, the session', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const { sessionId } = await openedTerminal(company, machineId, runner);
    const rows = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, machineId), eq(auditLog.action, 'terminal_open')));
    expect(rows).toEqual([
      expect.objectContaining({
        companyId: company.companyId,
        actorKind: 'user',
        actorPrincipalId: company.owner.principalId,
        entityType: 'machine',
        field: 'terminalSession',
        newValue: sessionId,
        requestId: expect.any(String),
      }),
    ]);
  });

  it('takes a ticket once, and not after 60 s', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const ticket = await ticketFor(w, company, machineId);
    await openTerminal(terminalUrl(w, { ticket, cols: 80, rows: 24 }));
    await runner.frames.next('terminal.open');
    await expect(openTerminal(terminalUrl(w, { ticket, cols: 80, rows: 24 }))).rejects.toThrow(
      'refused: 401',
    );
    const late = await ticketFor(w, company, machineId);
    w.clock.advance(TERMINAL_TICKET_TTL_MS);
    await expect(openTerminal(terminalUrl(w, { ticket: late, cols: 80, rows: 24 }))).rejects.toThrow(
      'refused: 401',
    );
    await expect(
      openTerminal(terminalUrl(w, { ticket: 'mwc_tt_guess', cols: 80, rows: 24 })),
    ).rejects.toThrow('refused: 401');
  });

  it('refuses another origin, a bad size and a plain request before the upgrade, keeping the ticket', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const ticket = await ticketFor(w, company, machineId);
    const url = terminalUrl(w, { ticket, cols: 80, rows: 24 });
    await expect(openTerminal(url, 'https://evil.example')).rejects.toThrow('refused: 403');
    await expect(openTerminal(url, null)).rejects.toThrow('refused: 403');
    await expect(openTerminal(terminalUrl(w, { ticket, cols: 1, rows: 24 }))).rejects.toThrow('refused: 400');
    await expect(openTerminal(terminalUrl(w, { ticket }))).rejects.toThrow('refused: 400');
    const plain = await fetch(url.replace('ws://', 'http://'));
    expect([plain.status, await plain.json()]).toMatchObject([426, { error: { code: 'upgrade_required' } }]);
    await openTerminal(url);
    expect((await runner.frames.next('terminal.open')).cols).toBe(80);
  });

  it('sends terminal.close when the browser closes its socket', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const { browser, sessionId } = await openedTerminal(company, machineId, runner);
    browser.socket.close();
    expect(await runner.frames.next('terminal.close')).toEqual({ type: 'terminal.close', sessionId });
  });

  it('ends the terminal with machine_disconnected when the runner goes away', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const { browser } = await openedTerminal(company, machineId, runner);
    await runner.disconnect();
    expect(await browser.next('exit')).toEqual({ type: 'exit', code: null, error: 'machine_disconnected' });
    expect((await browser.closed).code).toBe(1000);
  });

  it('says machine_offline or terminal_unavailable when that changed since the ticket, then closes', async () => {
    const { company, machineId, runner, runnerKey } = await onlineMachine();
    const ticket = await ticketFor(w, company, machineId);
    const again = await ticketFor(w, company, machineId);
    await runner.disconnect();
    await eventually('offline', () => !w.hub.isOnline(machineId));
    const offline = await openTerminal(terminalUrl(w, { ticket, cols: 80, rows: 24 }));
    expect(await offline.next('error')).toMatchObject({ code: 'machine_offline' });
    expect(await offline.closed).toEqual({ code: 1000, reason: 'No terminal' });
    // The machine's runner came back without its PTY.
    await w.connect(runnerKey, { caps: { terminal: false } });
    const bare = await openTerminal(terminalUrl(w, { ticket: again, cols: 80, rows: 24 }));
    expect(await bare.next('error')).toMatchObject({ code: 'terminal_unavailable' });
    expect((await bare.closed).code).toBe(1000);
  });

  it('answers a message it cannot read with an error and stays open; splits big input into 64 KB frames', async () => {
    const { company, machineId, runner } = await onlineMachine();
    const { browser } = await openedTerminal(company, machineId, runner);
    browser.socket.send('not json');
    browser.send({ type: 'resize', cols: 1, rows: 1 });
    await eventually('two errors', () => browser.messages.filter((m) => m.type === 'error').length === 2);
    expect(browser.messages.map((m) => m.type === 'error' && m.code)).toEqual([
      'invalid_message',
      'invalid_message',
    ]);
    browser.send({ type: 'input', data: 'x'.repeat(TERMINAL_DATA_MAX_BYTES + 10) });
    const first = await runner.frames.next('terminal.input');
    const second = await runner.frames.next('terminal.input');
    expect([first, second].map((frame) => Buffer.from(frame.data, 'base64').length)).toEqual([
      TERMINAL_DATA_MAX_BYTES,
      10,
    ]);
  });
});

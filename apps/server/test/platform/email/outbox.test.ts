import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureLogger, fixedClock, testConfig } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileOutbox, OUTBOX_DIR, outboxFileName } from '../../../src/platform/email/outbox.ts';
import { encodedHeader, headerValue, messageText } from '../../../src/platform/email/port.ts';
import { emailFromConfig } from '../../../src/platform/email/select.ts';

// The development outbox (S2.9): every email an `.eml` file in the data folder's outbox/, logged in one line; nothing
// is sent anywhere. The configuration picks it (MWC_EMAIL=outbox) or none.

let dataDir: string;
beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mwc-outbox-'));
});
afterAll(() => rm(dataDir, { recursive: true, force: true }));

const AT = new Date('2026-11-10T09:30:00.000Z');

describe('messageText', () => {
  it('writes the headers on one line each, encodes what is beyond ASCII, and ends lines with CRLF', () => {
    expect(headerValue('a\r\nBcc: x@y.z')).toBe('a Bcc: x@y.z');
    expect(encodedHeader('Plain subject')).toBe('Plain subject');
    expect(encodedHeader('Привіт, Олено')).toBe(
      `=?UTF-8?B?${Buffer.from('Привіт, Олено').toString('base64')}?=`,
    );
    const text = messageText(
      { to: 'mia@example.com\nBcc: evil@example.com', subject: 'You now report to Bob', text: 'One.\nTwo.' },
      'Team <team@example.com>',
      AT,
    );
    expect(text).toBe(
      [
        'From: Team <team@example.com>',
        'To: mia@example.com Bcc: evil@example.com',
        'Subject: You now report to Bob',
        'Date: Tue, 10 Nov 2026 09:30:00 GMT',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        'One.',
        'Two.',
        '',
      ].join('\r\n'),
    );
  });
});

describe('fileOutbox', () => {
  it('writes each email as a private .eml file named by time, and logs one line', async () => {
    const { logger, lines } = captureLogger();
    const outbox = fileOutbox({ dataDir, from: 'Team <team@example.com>', logger, clock: fixedClock(AT) });
    expect(outbox.kind).toBe('outbox');
    await outbox.send({ to: 'mia@example.com', subject: 'Hello', text: 'Hi.' });
    await outbox.send({ to: 'bob@example.com', subject: 'Again', text: 'Hi.' });
    const files = (await readdir(join(dataDir, OUTBOX_DIR))).sort();
    expect(files).toHaveLength(2);
    for (const file of files) expect(file.startsWith('2026-11-10T09-30-00.000Z-')).toBe(true);
    const path = join(dataDir, OUTBOX_DIR, files[0] as string);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toContain('From: Team <team@example.com>\r\n');
    const said = lines.filter((line) => line.msg === 'email written to the dev outbox (mwc dev outbox)');
    expect(said.map((line) => line.subject)).toEqual(['Hello', 'Again']);
    expect(outboxFileName(AT)).toMatch(/^2026-11-10T09-30-00\.000Z-[0-9a-f-]{36}\.eml$/);
  });
});

describe('emailFromConfig', () => {
  it('is the outbox for MWC_EMAIL=outbox and none for off', async () => {
    const { logger } = captureLogger();
    expect(emailFromConfig(testConfig, logger)).toBeUndefined();
    const outbox = emailFromConfig({ ...testConfig, MWC_EMAIL: 'outbox' }, logger, { dataDir });
    expect(outbox?.kind).toBe('outbox');
    expect(emailFromConfig({ ...testConfig, MWC_EMAIL: 'outbox' }, logger)?.kind).toBe('outbox');
    await outbox?.send({ to: 'x@example.com', subject: 'Now', text: 'Hi.' });
    expect(await readdir(join(dataDir, OUTBOX_DIR))).toHaveLength(3);
  });
});

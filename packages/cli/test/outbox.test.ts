import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/main.ts';
import { DEV_OUTBOX, decodeHeader, headersOf } from '../src/outbox.ts';
import { capture } from './fixtures/io.ts';

const root = mkdtempSync(join(tmpdir(), 'mwc-outbox-'));
const dir = join(root, 'outbox');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const email = (to: string, subject: string) =>
  [
    'From: Most Wanted Corp <no-reply@localhost>',
    `To: ${to}`,
    `Subject: ${subject}`,
    'Date: Tue, 10 Nov 2026 09:30:00 GMT',
    '',
    'You now report to Bob.',
    '',
  ].join('\r\n');

const run = (...argv: string[]) => {
  const c = capture();
  const code = main(['dev', 'outbox', ...argv], c.io, { outboxDir: dir });
  return { code, out: c.out(), err: c.err() };
};

describe('mwc dev outbox', () => {
  it('says the outbox is empty before the server wrote anything', () => {
    expect(run()).toEqual({
      code: 0,
      out: `The outbox is empty (${dir}). The development server writes emails there (MWC_EMAIL=outbox).\n`,
      err: '',
    });
    expect(DEV_OUTBOX.endsWith(join('.data', 'outbox'))).toBe(true);
  });

  it('lists the newest emails one line each, or in full', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-11-10T09-30-00.000Z-a.eml'), email('mia@example.com', 'First'));
    const encoded = `=?UTF-8?B?${Buffer.from('Привіт').toString('base64')}?=`;
    writeFileSync(join(dir, '2026-11-10T09-31-00.000Z-b.eml'), email('bob@example.com', encoded));
    writeFileSync(join(dir, 'notes.txt'), 'not an email');
    expect(run().out).toBe(
      [
        'Tue, 10 Nov 2026 09:30:00 GMT  bob@example.com  Привіт',
        'Tue, 10 Nov 2026 09:30:00 GMT  mia@example.com  First',
        '',
      ].join('\n'),
    );
    expect(run('--last', '1').out.split('\n')).toHaveLength(2);
    const full = run('--last', '1', '--full').out;
    expect(full).toContain('── 2026-11-10T09-31-00.000Z-b.eml\n');
    expect(full).toContain('Subject: Привіт\n');
    expect(full).toContain('You now report to Bob.');
  });

  it('refuses a bad --last and extra words', () => {
    for (const argv of [['--last', '0'], ['--last', 'many'], ['--last'], ['now']]) {
      const result = run(...argv);
      expect(result.code).toBe(2);
      expect(result.err).toBe('mwc dev outbox: usage: mwc dev outbox [--last N] [--full]\n');
    }
  });
});

describe('headersOf', () => {
  it('reads the head only, by lower-cased name, decoded', () => {
    const headers = headersOf('Subject: =?utf-8?B?SGk=?=\nTo: a@b.c\n\nBody: not a header\n');
    expect([...headers]).toEqual([
      ['subject', 'Hi'],
      ['to', 'a@b.c'],
    ]);
    expect(decodeHeader('plain')).toBe('plain');
    expect(headersOf('no colon here\n\n').size).toBe(0);
  });
});

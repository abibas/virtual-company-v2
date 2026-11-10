/**
 * The `EmailSender` port (S2.9, docs/notifications.md): one plain-text email to one address. The notifications module's
 * delivery job sends through it; `select.ts` picks the implementation MWC_EMAIL names (the development outbox, or none),
 * and tests pass their own. Rejecting means "try again later"; the caller counts the tries.
 */

/** One plain-text email. The From is the sender's (MWC_EMAIL_FROM). */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailSender {
  /** What it is, for the logs and `/api/config`: `outbox` writes files, it never sends. */
  readonly kind: 'outbox' | 'test';
  send(message: EmailMessage): Promise<void>;
}

/** A header value on one line: no CR or LF, so nothing can add a header of its own. */
export function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** A header value as RFC 2047 asks for anything beyond ASCII (`=?UTF-8?B?…?=`), plain otherwise. */
export function encodedHeader(value: string): string {
  const line = headerValue(value);
  if (/^[\x20-\x7e]*$/.test(line)) return line;
  return `=?UTF-8?B?${Buffer.from(line, 'utf8').toString('base64')}?=`;
}

/** The message as an RFC 5322 text (CRLF line ends), as an `.eml` file holds it. */
export function messageText(message: EmailMessage, from: string, date: Date): string {
  const headers = [
    `From: ${encodedHeader(from)}`,
    `To: ${headerValue(message.to)}`,
    `Subject: ${encodedHeader(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const body = message.text.replace(/\r?\n/g, '\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

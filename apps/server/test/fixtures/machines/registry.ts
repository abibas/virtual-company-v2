/**
 * A fake npm registry for the machines' latest tools: it answers each package's `latest` manifest from the versions it
 * holds (a 404 for a package it does not hold), records every read, and can hang until the read's deadline aborts it.
 */

export const CLAUDE_LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';
export const CODEX_LATEST_URL = 'https://registry.npmjs.org/@openai/codex/latest';

export interface RegistryRead {
  readonly url: string;
  readonly redirect: RequestInit['redirect'];
  readonly hasDeadline: boolean;
}

export class FakeRegistry {
  readonly reads: RegistryRead[] = [];
  /** The `latest` version by package address; a body string instead answers that text as is. */
  readonly answers = new Map<string, { status: number; body: string }>();
  /** Reads hang until their signal aborts. */
  hang = false;
  /** Reads fail as a network error. */
  down = false;

  /** Answers both packages' `latest` with these versions. */
  latest(claude: string, codex: string): this {
    this.answers.set(CLAUDE_LATEST_URL, {
      status: 200,
      body: JSON.stringify({ name: 'claude', version: claude }),
    });
    this.answers.set(CODEX_LATEST_URL, {
      status: 200,
      body: JSON.stringify({ name: 'codex', version: codex }),
    });
    return this;
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = String(input);
    const signal = init?.signal ?? undefined;
    this.reads.push({ url, redirect: init?.redirect, hasDeadline: signal instanceof AbortSignal });
    if (this.down) return Promise.reject(new TypeError('fetch failed'));
    if (this.hang) {
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    const answer = this.answers.get(url) ?? { status: 404, body: '{"error":"Not found"}' };
    return Promise.resolve(new Response(answer.body, { status: answer.status }));
  };
}

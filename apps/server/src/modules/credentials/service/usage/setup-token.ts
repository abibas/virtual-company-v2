import { amount, isoTime, limitWindow, windowOrder } from '../../rules/limits.ts';
import { OAUTH_BETA } from './claude.ts';
import {
  type CheckContext,
  discard,
  type LimitWindow,
  outcomeOf,
  providerCall,
  type SetupTokenSecret,
  statusFailure,
  UsageFailure,
  type UsageOutcome,
} from './http.ts';

/**
 * A setup-token's limits (`claude_setup_token`, S3.3). The usage API refuses these inference-only tokens (403, or 429
 * once asked often: v1's lesson), so the limits come from a one-token Messages request: every answer, and the 429 of a
 * reached limit too, carries the account's `anthropic-ratelimit-unified-<claim>-utilization` (a fraction),
 * `-reset` (epoch seconds) and `-status` (`rejected` when the window is reached) headers, per window: `5h`, `7d` and
 * the per-model `7d_<model>` ones. Only the headers are read; the reply is discarded. Each probe spends a little
 * of the 5-hour window, so its floor is 15 minutes (`USAGE_FLOOR_MS`).
 */

export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
/** The cheapest current Haiku: the probe asks for one token of it. */
export const PROBE_MODEL = 'claude-haiku-5-5';

const PREFIX = 'anthropic-ratelimit-unified-';

/** A window's utilization header: the claim (`5h`, `7d`, `7d_<model>`) is group 1, its length group 2. */
const UTILIZATION = /^anthropic-ratelimit-unified-((5h|7d)(_[a-z0-9]+)?)-utilization$/;

/**
 * The windows of a Messages answer's headers, 5-hour and weekly first: every claim it carries, per-model ones
 * (`7d_opus`, `7d_fable`, …) as `seven_day_<model>`; a claim with no utilization is not shown.
 */
export function headerWindows(headers: Headers): LimitWindow[] {
  const windows: LimitWindow[] = [];
  for (const [name, value] of headers) {
    const [, claim, length, model = ''] = UTILIZATION.exec(name) ?? [];
    if (claim === undefined) continue;
    const raw = value.trim();
    const fraction = raw ? amount(Number(raw)) : null;
    if (fraction === null) continue;
    const id = `${length === '5h' ? 'five_hour' : 'seven_day'}${model}`;
    const reached = headers.get(`${PREFIX}${claim}-status`) === 'rejected';
    const resetsAt = isoTime(headers.get(`${PREFIX}${claim}-reset`)?.trim());
    windows.push(limitWindow(id, fraction * 100, resetsAt, reached || undefined));
  }
  return windowOrder(windows);
}

/** A setup-token's windows from a one-token Messages request (see above). */
export function checkSetupToken(secret: SetupTokenSecret, ctx: CheckContext): Promise<UsageOutcome> {
  return outcomeOf(async () => {
    const response = await providerCall(ctx.fetch, MESSAGES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret.token}`,
        'anthropic-beta': OAUTH_BETA,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await discard(response);
    if (!response.ok && response.status !== 429) throw statusFailure(response);
    const windows = headerWindows(response.headers);
    if (windows.length === 0)
      throw response.ok ? new UsageFailure('invalid_response') : statusFailure(response);
    return windows;
  });
}

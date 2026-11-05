/**
 * Sign in with Claude and Sign in with OpenAI, as pure rules (S3.2, docs/subscriptions.md): the states of a sign-in,
 * its limits and refusals, and what the official CLIs' screens show the person: the provider's sign-in address, and
 * OpenAI's one-time code. The CLIs' output is read as the raw stream with its terminal codes taken out; an address
 * is passed on only when it is https on the provider's own sign-in host and path.
 */

export const SIGN_IN_PROVIDERS = ['claude', 'openai'] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/**
 * `starting` (the sandbox and the CLI start), `waiting_for_user` (the address, with OpenAI's code, is shown: the
 * person signs in at the provider), `waiting_for_code` (Claude asks for the code Anthropic's page shows), `completing`
 * (the login's files are read and stored), then one of `done`, `failed`, `expired` or `cancelled`.
 */
export const SIGN_IN_STATES = [
  'starting',
  'waiting_for_user',
  'waiting_for_code',
  'completing',
  'done',
  'failed',
  'expired',
  'cancelled',
] as const;
export type SignInState = (typeof SIGN_IN_STATES)[number];

const ACTIVE: ReadonlySet<SignInState> = new Set([
  'starting',
  'waiting_for_user',
  'waiting_for_code',
  'completing',
]);

/** A sign-in that has not ended: its sandbox may be running. */
export const isActive = (state: SignInState): boolean => ACTIVE.has(state);

/** Claude takes the pasted code once its address is shown, until the code is sent. */
export const takesCode = (provider: SignInProvider, state: SignInState): boolean =>
  provider === 'claude' && (state === 'waiting_for_user' || state === 'waiting_for_code');

/** The CLI stopped with success where a login is finished: after Claude's code, or once OpenAI's code is shown. */
export const finishesOnExit = (provider: SignInProvider, state: SignInState): boolean =>
  state === 'completing' || (provider === 'openai' && state === 'waiting_for_user');

/** How long a sign-in lives, how long the CLI has to show its address, and to finish after Claude's code. */
export const SIGN_IN_LIMITS = { ttlMs: 10 * 60_000, addressWaitMs: 90_000, codeWaitMs: 60_000 } as const;
export type SignInLimits = { readonly [K in keyof typeof SIGN_IN_LIMITS]: number };

/** A pasted Claude code (`<code>#<state>`): one word of URL-safe characters, so nothing else reaches the terminal. */
export const SIGN_IN_CODE = /^[A-Za-z0-9_.~#-]{10,1000}$/;

/** The provider's name in what the person reads. */
export const PROVIDER_NAMES: Record<SignInProvider, string> = { claude: 'Claude', openai: 'OpenAI' };

/** Why a sign-in ended without a subscription, in plain words. */
export const SIGN_IN_ENDINGS = {
  expired: 'The sign-in took longer than 10 minutes. Start again.',
  cancelled: 'You cancelled this sign-in.',
  noAddress: (name: string) => `${name} did not show a sign-in address in time. Start again.`,
  stopped: (name: string) => `The ${name} sign-in stopped before it finished. Start again.`,
  codeRefused:
    'Claude did not accept the code. Start again, and paste the whole code from the page you open from here.',
  codeTimeout: 'Claude did not finish signing in after the code. Start again.',
  notSaved: 'The login could not be saved. Start again.',
} as const;

/** Why a sign-in failed when its CLI stopped without a finished login, from where it was. */
export function exitEnding(provider: SignInProvider, state: SignInState): string {
  const name = PROVIDER_NAMES[provider];
  if (state === 'completing') return SIGN_IN_ENDINGS.codeRefused;
  if (state === 'starting') return SIGN_IN_ENDINGS.noAddress(name);
  return SIGN_IN_ENDINGS.stopped(name);
}

/** A sign-in request the routes refuse, in the common error shape. */
export interface SignInRefusal<S extends 404 | 409 | 503 = 404 | 409 | 503> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

/** Another person's sign-in, an old one or no such id: the same 404. */
export const SIGN_IN_NOT_FOUND: SignInRefusal<404> = {
  ok: false,
  status: 404,
  code: 'sign_in_not_found',
  message: 'No such sign-in of yours',
};

export const SIGN_IN_ACTIVE: SignInRefusal<409> = {
  ok: false,
  status: 409,
  code: 'sign_in_active',
  message: 'You are already signing in. Finish or cancel that sign-in first.',
};

export const SIGN_IN_NOT_WAITING: SignInRefusal<409> = {
  ok: false,
  status: 409,
  code: 'sign_in_not_waiting',
  message: 'This sign-in is not waiting for a code',
};

export const SIGN_IN_UNAVAILABLE: SignInRefusal<503> = {
  ok: false,
  status: 503,
  code: 'sign_in_unavailable',
  message: 'Signing in with a subscription is off on this server (MWC_LOGIN_HELPER=none)',
};

/** What the CLI's screen shows the person. */
export interface Shown {
  /** The provider's sign-in address. */
  readonly url: string;
  /** OpenAI's one-time code, typed in on its page. */
  readonly userCode: string | null;
  /** Claude's prompt for the pasted code is on the screen. */
  readonly asksForCode: boolean;
}

/** An OSC 8 hyperlink's target: `ESC ] 8 ; params ; URL` ended by BEL or ESC \. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape codes are what it reads
const HYPERLINK = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)(?:\x07|\x1b\\)/g;
/** OSC sequences (hyperlinks, titles), then CSI sequences (colours, cursor), then the other escapes (`ESC 7`, `ESC (B`). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape codes are what it takes out
const TERMINAL_CODES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]/g;

/** The output as text: terminal codes taken out, carriage returns as line ends. */
export function plainText(output: string): string {
  return output.replace(TERMINAL_CODES, '').replace(/\r\n?/g, '\n');
}

/** Every https address in the output: hyperlink targets first, then the visible text's. */
function addresses(output: string): string[] {
  const linked = [...output.matchAll(HYPERLINK)].map((match) => match[1] as string);
  const visible = plainText(output).match(/https:\/\/[^\s"'<>]+/g) ?? [];
  return [...linked, ...visible];
}

/** The first address on one of `hosts` whose path matches, as a normalized URL. */
function firstAddress(output: string, hosts: ReadonlySet<string>, path: (pathname: string) => boolean) {
  for (const candidate of addresses(output)) {
    const url = URL.parse(candidate);
    if (url?.protocol === 'https:' && hosts.has(url.hostname) && path(url.pathname)) return url.toString();
  }
  return undefined;
}

const CLAUDE_HOSTS: ReadonlySet<string> = new Set([
  'claude.com',
  'claude.ai',
  'platform.claude.com',
  'console.anthropic.com',
]);

/** `claude auth login`: "If the browser didn't open, visit: <address>", then "Paste code here if prompted >". */
export function claudeScreen(output: string): Shown | undefined {
  const url = firstAddress(output, CLAUDE_HOSTS, (path) => path.endsWith('/oauth/authorize'));
  if (url === undefined) return undefined;
  return { url, userCode: null, asksForCode: /paste code here/i.test(plainText(output)) };
}

const OPENAI_HOSTS: ReadonlySet<string> = new Set(['auth.openai.com']);
/** The one-time code on its own line, as `18YW-CSSN5`. */
const DEVICE_CODE = /^\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\s*$/m;

/** `codex login --device-auth`: "Open this link …" with the address, then "Enter this one-time code …" and the code. */
export function codexScreen(output: string): Shown | undefined {
  const url = firstAddress(output, OPENAI_HOSTS, (path) => path.startsWith('/codex/device'));
  if (url === undefined) return undefined;
  const text = plainText(output);
  const after = text.slice(Math.max(0, text.search(/one-time code/i)));
  const code = after.match(DEVICE_CODE)?.[1];
  return code === undefined ? undefined : { url, userCode: code, asksForCode: false };
}

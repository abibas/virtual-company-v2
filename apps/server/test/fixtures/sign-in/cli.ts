/**
 * Made-up output and files of the official CLIs' logins, shaped like what the pinned versions print and write
 * (claude-code 2.1.308 `claude auth login --claudeai`, codex 0.163.0 `codex login --device-auth`): terminal codes,
 * OSC 8 hyperlinks and carriage returns included. Every token, code and id here is fake; `SECRETS` lists the values
 * no response, row or log line may ever contain.
 */

const ESC = '\u001b';
const BEL = '\u0007';
const link = (url: string) => `${ESC}]8;;${url}${BEL}${ESC}[94m${url}${ESC}[39m${ESC}]8;;${BEL}`;

export const CLAUDE_AUTHORIZE_URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=00000000-fake-4000-8000-000000000000' +
  '&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback' +
  '&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference&code_challenge=FAKEchallenge0123456789' +
  '&code_challenge_method=S256&state=FAKEstate0123456789';

/** What `claude auth login --claudeai` prints before the code, in the two chunks it arrives in. */
export const CLAUDE_OUTPUT = {
  opening: 'Opening browser to sign in…\r\n',
  address: `If the browser didn't open, visit: ${link(CLAUDE_AUTHORIZE_URL)}\r\n`,
  prompt: 'Paste code here if prompted > ',
  success: 'Login successful.\r\n',
  refused: 'OAuth error: Request failed with status code 400\r\n',
} as const;

/** What Ihor pastes back from Anthropic's page: `<code>#<state>`. */
export const CLAUDE_CODE = 'FAKEpastedCODE0123456789abcdef#FAKEstate0123456789';

export const CODEX_DEVICE_URL = 'https://auth.openai.com/codex/device';
export const CODEX_USER_CODE = 'FAKE-C0DE9';

/** What `codex login --device-auth` prints while it waits. */
export const CODEX_OUTPUT = {
  welcome: `\r\nWelcome to Codex [v${ESC}[90m0.163.0${ESC}[0m]\r\n${ESC}[90mOpenAI's command-line coding agent${ESC}[0m\r\n\r\n`,
  steps:
    'Follow these steps to sign in with ChatGPT using device code authorization:\r\n\r\n' +
    '1. Open this link in your browser and sign in to your account\r\n' +
    `   ${ESC}[94m${CODEX_DEVICE_URL}${ESC}[0m\r\n\r\n`,
  code:
    `2. Enter this one-time code ${ESC}[90m(expires in 15 minutes)${ESC}[0m\r\n` +
    `   ${ESC}[94m${CODEX_USER_CODE}${ESC}[0m\r\n\r\n` +
    `${ESC}[90mContinue only if you started this login in Codex. If a website or another person gave you this code, ` +
    `cancel.${ESC}[0m\r\n\r\n`,
  success: 'Successfully logged in\r\n',
  failure: 'Error logging in with device code: device code expired\r\n',
} as const;

const CLAUDE_ACCESS = 'sk-ant-oat01-FAKEaccessTOKENneverSHOWN0123456789';
const CLAUDE_REFRESH = 'sk-ant-ort01-FAKErefreshTOKENneverSHOWN0123456789';
const CODEX_ACCESS = 'eyFAKEcodexACCESStokenNEVERshown.0123456789';
const CODEX_REFRESH = 'rt_FAKEcodexREFRESHtokenNEVERshown0123456789';

/** `~/.claude/.credentials.json` after the login. */
export const CLAUDE_CREDENTIALS = {
  claudeAiOauth: {
    accessToken: CLAUDE_ACCESS,
    refreshToken: CLAUDE_REFRESH,
    expiresAt: 1_793_000_000_000,
    scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_20x',
  },
};

export const CLAUDE_ACCOUNT = {
  accountUuid: '11111111-fake-4000-8000-000000000001',
  emailAddress: 'ihor@example.test',
  organizationUuid: '22222222-fake-4000-8000-000000000002',
  organizationName: "Ihor's Organization",
  displayName: 'Ihor',
};

/** `~/.claude.json` after the login: its account, and settings the store does not keep. */
export const CLAUDE_CONFIG = {
  numStartups: 0,
  userID: 'FAKEuserID0123456789',
  oauthAccount: CLAUDE_ACCOUNT,
  projects: {},
};

/** A JWT with these claims and a signature nobody checks. */
export const fakeJwt = (claims: Record<string, unknown>) =>
  ['{"alg":"RS256","typ":"JWT"}', JSON.stringify(claims), 'FAKEsignature']
    .map((part, index) => (index < 2 ? Buffer.from(part).toString('base64url') : part))
    .join('.');

const CODEX_ID_TOKEN = fakeJwt({
  email: 'ihor@example.test',
  'https://api.openai.com/auth': { chatgpt_plan_type: 'pro', chatgpt_account_id: 'acct-FAKE0001' },
});

/** `~/.codex/auth.json` after the login. */
export const CODEX_AUTH = {
  OPENAI_API_KEY: null,
  tokens: {
    id_token: CODEX_ID_TOKEN,
    access_token: CODEX_ACCESS,
    refresh_token: CODEX_REFRESH,
    account_id: 'acct-FAKE0001',
  },
  last_refresh: '2026-11-05T12:00:00Z',
};

/** The login files as the sandbox holds them, by their path under its home. */
export const CLAUDE_FILES = {
  '.claude/.credentials.json': JSON.stringify(CLAUDE_CREDENTIALS),
  '.claude.json': JSON.stringify(CLAUDE_CONFIG),
};
export const CODEX_FILES = { '.codex/auth.json': JSON.stringify(CODEX_AUTH) };

/** Values that never leave the server: tokens, the pasted code, the id_token. */
export const SECRETS = [
  CLAUDE_ACCESS,
  CLAUDE_REFRESH,
  CODEX_ACCESS,
  CODEX_REFRESH,
  CODEX_ID_TOKEN,
  CLAUDE_CODE,
];

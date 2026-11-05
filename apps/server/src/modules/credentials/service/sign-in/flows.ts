import { claudeLogin, codexLogin, LOGIN_FILES, type LoginOutcome } from '../../rules/login-files.ts';
import { claudeScreen, codexScreen, type Shown, type SignInProvider } from '../../rules/sign-in.ts';

/** The sandbox's files, as a flow reads them (`LoginSandbox.readFile`). */
export interface LoginFiles {
  readFile(path: string): Promise<string | undefined>;
}

/**
 * The two logins (S3.2): which official CLI command runs, how its screen is read, and which files make the stored
 * subscription. Checked against the pinned CLIs (deploy/Dockerfile.login) up to the address they print.
 */
export interface SignInFlow {
  readonly provider: SignInProvider;
  /** The full login of the CLI: never typed in by a person. */
  readonly argv: readonly string[];
  /** What the screen shows so far, once the address is on it. */
  read(output: string): Shown | undefined;
  /** Reads the finished login's files from the sandbox and makes what is stored. */
  result(sandbox: LoginFiles): Promise<LoginOutcome>;
}

/**
 * Claude Code's subscription login (`claude auth login --claudeai`, the full OAuth login with a refresh token, not the
 * inference-only `setup-token`): it prints Anthropic's authorize address and waits at "Paste code here if prompted >"
 * for the code Anthropic's page shows, then writes `~/.claude/.credentials.json` and `~/.claude.json`.
 */
const claude: SignInFlow = {
  provider: 'claude',
  argv: ['claude', 'auth', 'login', '--claudeai'],
  read: claudeScreen,
  async result(sandbox) {
    const credentials = await sandbox.readFile(LOGIN_FILES.claudeCredentials);
    const config =
      (await sandbox.readFile(LOGIN_FILES.claudeConfig)) ??
      (await sandbox.readFile(LOGIN_FILES.claudeConfigInDir));
    return claudeLogin({ credentials, config });
  },
};

/**
 * Codex's device login (`codex login --device-auth`, its credentials kept in a file): it prints OpenAI's device page
 * and a one-time code, waits until the person has entered it there, then writes `~/.codex/auth.json`.
 */
const openai: SignInFlow = {
  provider: 'openai',
  argv: ['codex', 'login', '--device-auth', '-c', 'cli_auth_credentials_store=file'],
  read: codexScreen,
  async result(sandbox) {
    return codexLogin({ auth: await sandbox.readFile(LOGIN_FILES.codexAuth) });
  },
};

export const SIGN_IN_FLOWS: Record<SignInProvider, SignInFlow> = { claude, openai };

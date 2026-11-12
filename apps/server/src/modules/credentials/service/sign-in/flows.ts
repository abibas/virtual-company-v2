import type { LoginSandbox } from '../../../../platform/processes/login-helper/port.ts';
import {
  claudeLogin,
  codexLogin,
  githubLogin,
  LOGIN_FILES,
  type LoginOutcome,
} from '../../rules/login-files.ts';
import {
  claudeScreen,
  codexScreen,
  githubScreen,
  type Shown,
  type SignInProvider,
} from '../../rules/sign-in.ts';

/** What a flow reads from the sandbox once its login has finished: its files, and short commands of its CLI. */
export type LoginFiles = Pick<LoginSandbox, 'readFile' | 'run'>;

/**
 * The logins (S3.2, GitHub's S7.1a): which official CLI command runs, how its screen is read, and which files (or, for
 * GitHub, which of its commands) make the stored sign-in. Checked against the pinned CLIs (deploy/Dockerfile.login) up
 * to the address they print.
 */
export interface SignInFlow {
  readonly provider: SignInProvider;
  /** The full login of the CLI: never typed in by a person. */
  readonly argv: readonly string[];
  /** Behind a pseudo-terminal (the default), or with plain pipes (`false`). */
  readonly tty?: boolean;
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

/** What a finished GitHub login's commands printed, or undefined when one failed. */
async function printed(sandbox: LoginFiles, argv: readonly string[]): Promise<string | undefined> {
  const run = await sandbox.run(argv);
  return run.code === 0 ? run.stdout : undefined;
}

/**
 * The GitHub CLI's device sign-in (S7.1a), as a person signs in `gh` on their own computer: `gh auth login --hostname
 * github.com --git-protocol https --web`, with `--scopes workflow` (what an interactive https login adds when it sets
 * up git's credentials, so pushes that change workflows work) and `--insecure-storage` (the sandbox has no keyring: the
 * token goes to its throwaway home). With no terminal it never prompts: it prints the one-time code and
 * github.com/login/device, and exits once the person has entered the code there. Then `gh auth token` gives the token
 * and `gh api user --include` the account and scopes.
 */
const github: SignInFlow = {
  provider: 'github',
  argv: [
    'gh',
    'auth',
    'login',
    '--hostname',
    'github.com',
    '--git-protocol',
    'https',
    '--web',
    '--scopes',
    'workflow',
    '--insecure-storage',
  ],
  tty: false,
  read: githubScreen,
  async result(sandbox) {
    const token = await printed(sandbox, ['gh', 'auth', 'token', '--hostname', 'github.com']);
    const user = await printed(sandbox, ['gh', 'api', 'user', '--include']);
    return githubLogin({ token, user });
  },
};

export const SIGN_IN_FLOWS: Record<SignInProvider, SignInFlow> = { claude, openai, github };

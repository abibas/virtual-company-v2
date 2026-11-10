import { z } from 'zod';
import { PORTS, SLOT_COUNT, slotPorts } from './ports.ts';

/** An empty variable (`MWC_PORT_SLOT=` in a .env file) counts as unset, not as 0. */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

/** Which identity provider signs people in; `none` serves health and the UI only (MWC_IDENTITY). */
export const IdentityMode = z.enum(['clerk', 'none']);

/**
 * The shape of a Clerk secret key, `sk_test_...` or `sk_live_...` (the Clerk connector checks it the same way). Only a
 * key of this shape turns sign-in on by default; a placeholder or a half-pasted key leaves it off.
 */
export const CLERK_SECRET_KEY_PATTERN = /^sk_(test|live)_[A-Za-z0-9]{20,}$/;

/** The master key's shape: the standard base64 of exactly 32 bytes, as `openssl rand -base64 32` prints it. */
const MASTER_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

/** The 32 bytes of a well-formed MWC_MASTER_KEY, or undefined for anything else. Nothing here echoes the value. */
export function decodeMasterKey(value: string): Uint8Array | undefined {
  if (!MASTER_KEY_PATTERN.test(value)) return undefined;
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * Where Sign in with Claude and Sign in with OpenAI run the official CLI's login (MWC_LOGIN_HELPER,
 * docs/subscriptions.md): a throwaway Docker container (`docker`), a private temporary folder on a Linux server that
 * has the CLIs (`local`), or nowhere (`none`: those sign-ins answer 503).
 */
export const LoginHelperMode = z.enum(['docker', 'local', 'none']);

/**
 * Whether the server starts and stops the Airia devboxes itself with this computer's airia CLI and gcloud, and holds
 * their tunnels (MWC_LOCAL_POWER, docs/machines.md): `auto` when both are found outside production, `on` always (the
 * start fails without them), `off` never (runner controllers do it).
 */
export const LocalPowerMode = z.enum(['auto', 'on', 'off']);

/**
 * Whether the server rebuilds a container runner's image itself to update its runner, with this computer's Docker CLI
 * (MWC_LOCAL_DOCKER, docs/machines.md "Updating a runner"): `auto` when `docker` is found and NODE_ENV is development,
 * `on` whenever it is found (the start fails without it), `off` never (the card shows the command to run instead).
 */
export const LocalDockerMode = z.enum(['auto', 'on', 'off']);

/**
 * Whether dictation transcribes with whisper.cpp on the server's own computer (MWC_WHISPER, docs/speech.md): `auto` when
 * its binaries and a model are found, outside production and tests; `off` never (`POST /api/me/speech/transcribe` 503s).
 */
export const WhisperMode = z.enum(['auto', 'off']);

/** Who may create companies (MWC_COMPANY_CREATION): anyone signed in, the MWC_COMPANY_CREATORS, or nobody. */
export const CompanyCreation = z.enum(['any', 'allowlist', 'none']);

/** A comma-separated list (`a@x.com, b@y.com`) as trimmed, lower-cased entries; empty or unset is none. */
const emailList = (value: unknown) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== '')
    : value;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Worktree slot 0..9 (docs/ports.md): when set and MWC_PORT is not, the API listens on the slot's port. */
  MWC_PORT_SLOT: z.preprocess(
    emptyAsUnset,
    z.coerce
      .number()
      .int()
      .min(0)
      .max(SLOT_COUNT - 1)
      .optional(),
  ),
  MWC_PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65535).optional()),
  /** Defaults to http://localhost:<effective MWC_PORT>. */
  MWC_PUBLIC_URL: z.preprocess(emptyAsUnset, z.url().optional()),
  MWC_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The address the API binds to: loopback by default; the compose image sets 0.0.0.0. */
  MWC_HOST: z.preprocess(emptyAsUnset, z.union([z.ipv4(), z.ipv6(), z.hostname()]).default('127.0.0.1')),
  /** Apply pending migrations when the server starts (true/false, 1/0, yes/no, on/off). Default false. */
  MWC_MIGRATE_ON_START: z.preprocess(emptyAsUnset, z.stringbool().default(false)),
  /** The built web UI (apps/web/dist) the server serves for `/`; the container image sets it. */
  MWC_WEB_DIST: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  /**
   * The web origin whose session tokens the API accepts (Clerk's `azp`, the provider's `authorizedParties`).
   * Defaults to the web dev server (9951, or the slot's web port) and, in production, to MWC_PUBLIC_URL,
   * since the server serves the UI there.
   */
  MWC_WEB_ORIGIN: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/ }).optional()),
  /**
   * `clerk` or `none` (sign-in off: identity routes answer 503). Defaults to clerk when CLERK_SECRET_KEY is a
   * well-formed key (CLERK_SECRET_KEY_PATTERN), else none; MWC_IDENTITY=clerk with a bad key fails at startup.
   */
  MWC_IDENTITY: z.preprocess(emptyAsUnset, IdentityMode.optional()),
  /** Clerk's keys (docs/clerk-setup.md); their shape is checked by the connector, never echoed. */
  CLERK_SECRET_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  CLERK_PUBLISHABLE_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  CLERK_JWT_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  /**
   * The Clerk webhook endpoint's signing secret (`whsec_...`). Optional: without it `POST /api/webhooks/clerk`
   * answers 503 `webhooks_not_configured` and reconcile keeps memberships current.
   */
  CLERK_WEBHOOK_SIGNING_SECRET: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  /** `any`, `allowlist` or `none`. Defaults to `any`, and to `allowlist` in production. */
  MWC_COMPANY_CREATION: z.preprocess(emptyAsUnset, CompanyCreation.optional()),
  /** The emails MWC_COMPANY_CREATION=allowlist lets create companies, comma-separated, compared lower-cased. */
  MWC_COMPANY_CREATORS: z.preprocess(emailList, z.array(z.email()).default([])),
  /**
   * Run the jobs loop in this process (on/off, true/false, 1/0, yes/no): the identity outbox, the retry of webhook
   * events and the periodic reconcile; one process per database runs them (an advisory lock). Defaults to on, and to
   * off with NODE_ENV=test, so tests start it only when they ask.
   */
  MWC_JOBS: z.preprocess(emptyAsUnset, z.stringbool().optional()),
  /** Minutes between two reconciles of one company with its organization (1 to 1440). Default 10. */
  MWC_RECONCILE_MINUTES: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(1440).default(10)),
  /**
   * The master key that seals people's subscriptions (AES-256-GCM): the base64 of 32 random bytes. Required in
   * production; in development the server makes `.data/master.key` once instead, and tests use a key in memory. A
   * secret: never logged or echoed, and a problem names the variable only.
   */
  MWC_MASTER_KEY: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .refine((value) => decodeMasterKey(value) !== undefined, 'must be the base64 of 32 bytes')
      .optional(),
  ),
  /**
   * The sign-in helper: `docker`, `local` or `none`. Defaults to docker in development and to none in production
   * (whose image does not carry the CLIs yet) and in tests (which pass a fake).
   */
  MWC_LOGIN_HELPER: z.preprocess(emptyAsUnset, LoginHelperMode.optional()),
  /** `auto` (the default), `on` or `off`: whether this server drives the airia CLI itself (LocalPowerMode). */
  MWC_LOCAL_POWER: z.preprocess(emptyAsUnset, LocalPowerMode.default('auto')),
  /** `auto` (the default), `on` or `off`: whether this server rebuilds container runners itself (LocalDockerMode). */
  MWC_LOCAL_DOCKER: z.preprocess(emptyAsUnset, LocalDockerMode.default('auto')),
  /** `auto` (the default) or `off`: dictation with this computer's whisper.cpp (WhisperMode). */
  MWC_WHISPER: z.preprocess(emptyAsUnset, WhisperMode.default('auto')),
  /** The whisper.cpp model (a ggml-*.bin file; `~/` is the home folder). Unset: the first known one that exists. */
  MWC_WHISPER_MODEL: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  /** The language Whisper hears (`en`, `uk`, ...), or `auto` (the default) to detect it per clip. */
  MWC_WHISPER_LANGUAGE: z.preprocess(
    emptyAsUnset,
    z
      .string()
      .regex(/^[a-z]{2,3}$|^auto$/)
      .default('auto'),
  ),
  /** Words Whisper should spell this way (names, products), sent as its prompt. Optional. */
  MWC_WHISPER_PROMPT: z.preprocess(emptyAsUnset, z.string().max(1000).optional()),
  /** The port of the warm whisper-server, on 127.0.0.1 only. Default 9957 (docs/ports.md). */
  MWC_WHISPER_PORT: z.preprocess(
    emptyAsUnset,
    z.coerce.number().int().min(1).max(65535).default(PORTS.whisper),
  ),
});

export type IdentityMode = z.infer<typeof IdentityMode>;
export type CompanyCreation = z.infer<typeof CompanyCreation>;
export type LoginHelperMode = z.infer<typeof LoginHelperMode>;
export type LocalPowerMode = z.infer<typeof LocalPowerMode>;
export type LocalDockerMode = z.infer<typeof LocalDockerMode>;
export type WhisperMode = z.infer<typeof WhisperMode>;

/** MWC_IDENTITY when it is set, else clerk for a well-formed Clerk secret key, else none. */
function identityMode(env: z.infer<typeof EnvSchema>): IdentityMode {
  return env.MWC_IDENTITY ?? (CLERK_SECRET_KEY_PATTERN.test(env.CLERK_SECRET_KEY ?? '') ? 'clerk' : 'none');
}

/** MWC_IDENTITY=clerk (set, or implied by the secret key) needs both Clerk keys. */
function requireClerkKeys(env: z.infer<typeof EnvSchema>, ctx: z.RefinementCtx): void {
  if (identityMode(env) !== 'clerk') return;
  for (const key of ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY'] as const) {
    if (!env[key])
      ctx.addIssue({ code: 'custom', path: [key], message: 'required when MWC_IDENTITY is clerk' });
  }
}

/** Production seals subscriptions only under a master key it is given: it never makes one of its own. */
function requireMasterKey(env: z.infer<typeof EnvSchema>, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV !== 'production' || env.MWC_MASTER_KEY !== undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: ['MWC_MASTER_KEY'],
    message: 'required in production (the base64 of 32 random bytes: openssl rand -base64 32)',
  });
}

/** The default web origin: the public URL in production, else the web dev server of the port or slot. */
function defaultWebOrigin(env: z.infer<typeof EnvSchema>, publicUrl: string): string {
  if (env.NODE_ENV === 'production') return new URL(publicUrl).origin;
  const web = env.MWC_PORT_SLOT === undefined ? PORTS.web : slotPorts(env.MWC_PORT_SLOT).web;
  return `http://localhost:${web}`;
}

/**
 * Process configuration, 12-factor style: everything comes from the environment,
 * is validated once at startup, and a missing or malformed value fails fast.
 * Precedence for the API port: MWC_PORT, then MWC_PORT_SLOT's API port, then 9950. Company creation is open
 * to anyone signed in, except in production, where only MWC_COMPANY_CREATORS may create. The jobs loop runs unless
 * MWC_JOBS turns it off or NODE_ENV is test. Production needs MWC_MASTER_KEY. The sign-in helper is Docker in development
 * and off elsewhere unless MWC_LOGIN_HELPER names one. The Clerk keys and the master key are
 * secrets: nothing logs the configuration, and a problem names the variable, never its value.
 */
export const ConfigSchema = EnvSchema.superRefine((env, ctx) => {
  requireClerkKeys(env, ctx);
  requireMasterKey(env, ctx);
}).transform((env) => {
  const {
    MWC_PORT_SLOT,
    MWC_PORT,
    MWC_PUBLIC_URL,
    MWC_WEB_ORIGIN,
    MWC_IDENTITY,
    MWC_COMPANY_CREATION,
    MWC_JOBS,
    MWC_LOGIN_HELPER,
    ...rest
  } = env;
  const port = MWC_PORT ?? (MWC_PORT_SLOT === undefined ? PORTS.api : slotPorts(MWC_PORT_SLOT).api);
  const publicUrl = MWC_PUBLIC_URL ?? `http://localhost:${port}`;
  const identity = identityMode(env);
  return {
    ...rest,
    ...(MWC_PORT_SLOT === undefined ? {} : { MWC_PORT_SLOT }),
    MWC_PORT: port,
    MWC_PUBLIC_URL: publicUrl,
    /** MWC_PUBLIC_URL was given rather than derived from the port (`/api/config`'s `publicUrl` is null without it). */
    MWC_PUBLIC_URL_SET: MWC_PUBLIC_URL !== undefined,
    MWC_WEB_ORIGIN:
      MWC_WEB_ORIGIN === undefined ? defaultWebOrigin(env, publicUrl) : new URL(MWC_WEB_ORIGIN).origin,
    MWC_IDENTITY: identity,
    MWC_COMPANY_CREATION: MWC_COMPANY_CREATION ?? (env.NODE_ENV === 'production' ? 'allowlist' : 'any'),
    MWC_JOBS: MWC_JOBS ?? env.NODE_ENV !== 'test',
    MWC_LOGIN_HELPER: MWC_LOGIN_HELPER ?? (env.NODE_ENV === 'development' ? 'docker' : 'none'),
  };
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    const lines = issues.map((issue) => `  ${issue.path}: ${issue.message}`);
    super(`Invalid configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Parse the given environment (defaults to `process.env`); throws `ConfigError` with every problem listed. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

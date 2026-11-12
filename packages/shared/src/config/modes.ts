import { z } from 'zod';

/**
 * The configuration's modes (`../config.ts`, which re-exports them): each one's values, as `EnvSchema` checks them,
 * and its type.
 */

/** Which identity provider signs people in; `none` serves health and the UI only (MWC_IDENTITY). */
export const IdentityMode = z.enum(['clerk', 'none']);

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

/**
 * How notification emails go out (MWC_EMAIL, docs/notifications.md): written to the development outbox
 * (`.data/outbox/`, read with `mwc dev outbox`), through SMTP (not built yet: refused), or not at all.
 */
export const EmailMode = z.enum(['outbox', 'smtp', 'off']);

/** Who may create companies (MWC_COMPANY_CREATION): anyone signed in, the MWC_COMPANY_CREATORS, or nobody. */
export const CompanyCreation = z.enum(['any', 'allowlist', 'none']);

export type IdentityMode = z.infer<typeof IdentityMode>;
export type EmailMode = z.infer<typeof EmailMode>;
export type CompanyCreation = z.infer<typeof CompanyCreation>;
export type LoginHelperMode = z.infer<typeof LoginHelperMode>;
export type LocalPowerMode = z.infer<typeof LocalPowerMode>;
export type LocalDockerMode = z.infer<typeof LocalDockerMode>;
export type WhisperMode = z.infer<typeof WhisperMode>;

import {
  fitsGateway,
  fitsProvider,
  gatewayFitsProfile,
  PROFILE_GATEWAY_PROVIDER,
  PROVIDER_KINDS,
} from '@mwc/shared/credentials';
import type { CredentialKind, CredentialStatus, Effort, ProfileProvider } from '@mwc/shared/enums';

// Access profiles' own rules (S3.4, one provider each since 2026-11-10, docs/subscriptions.md): what a profile's
// subscription and gateway take (a gateway of the profile's own provider since migration 0016), what a change writes,
// and what the audit log keeps of a profile; which model and effort it may run is `profile-model.ts`'s. Who gives a
// profile to an agent, and to which harness it fits, is the org module's rule. Pure.

/** A profile's two credentials: its subscription and its gateway. */
export type ProfilePart = 'subscription' | 'gateway';

/** The column that holds each part's credential. */
const PART_COLUMNS = {
  subscription: 'credentialId',
  gateway: 'gatewayCredentialId',
} as const satisfies Record<ProfilePart, string>;

type PartColumn = (typeof PART_COLUMNS)[ProfilePart];

/** A profile's credentials as a request gives them: a credential id, null to empty one, or left out to keep it. */
export type CredentialChoice = { readonly [C in PartColumn]?: string | null | undefined };

/** What a profile runs: a model and an effort, each null for the provider's default. */
export interface ProfileRuns {
  readonly model: string | null;
  readonly effort: Effort | null;
}

/** A profile's name, credentials, model and effort as stored. */
export type ProfileFields = { readonly name: string } & {
  readonly [C in PartColumn]: string | null;
} & ProfileRuns;

/** A change of what a profile runs, as a request gives it: a value, null for the default, or left out to keep it. */
export type RunsChoice = { readonly [K in keyof ProfileRuns]?: ProfileRuns[K] | undefined };

type RefusalStatus = 404 | 409 | 422;

/** A refusal the profile routes answer in the common error shape, typed by its status so each route documents it. */
export interface ProfileRefusal<S extends RefusalStatus = RefusalStatus> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

export const refuse = <S extends RefusalStatus>(
  status: S,
  code: string,
  message: string,
): ProfileRefusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

/** Another person's profile, or no such id: the same 404, as for subscriptions. */
export const PROFILE_NOT_FOUND = refuse(404, 'access_profile_not_found', 'No such access profile');

export const profileNameTaken = (name: string) =>
  refuse(409, 'access_profile_name_taken', `You have an access profile named ${name} already`);

/** Each provider's name with its article, as messages show it: "a Claude", "an OpenAI". */
export const A_PROVIDER: Readonly<Record<ProfileProvider, string>> = {
  claude: 'a Claude',
  openai: 'an OpenAI',
};

/** A change that names another provider than the profile's: it is fixed when the profile is made. */
export const providerFixed = (provider: ProfileProvider) =>
  refuse(
    422,
    'provider_mismatch',
    `This is ${A_PROVIDER[provider]} profile, and a profile's provider is fixed: make a new profile for the other one`,
  );

export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const PART_NAMES: Readonly<Record<ProfilePart, string>> = {
  subscription: 'its subscription',
  gateway: 'its gateway',
};

/** What each gateway provider's gateways are for, as messages say it. */
const GATEWAY_FOR = { anthropic: 'Claude Code', openai: 'Codex' } as const;

/** A gateway of the other provider than the profile's: a Claude profile takes one for Claude Code, OpenAI for Codex. */
export const gatewayProviderMismatch = (provider: ProfileProvider) => {
  const wanted = PROFILE_GATEWAY_PROVIDER[provider];
  const other = wanted === 'anthropic' ? 'openai' : 'anthropic';
  const message = `profile takes a gateway for ${GATEWAY_FOR[wanted]}, not one for ${GATEWAY_FOR[other]}`;
  return refuse(422, 'gateway_provider_mismatch', `${capital(A_PROVIDER[provider])} ${message}`);
};

/** What the rules read of a credential: its kind, its state and its account details (a gateway's provider). */
export interface HeldCredential {
  readonly kind: CredentialKind;
  readonly status: CredentialStatus;
  readonly accountMeta: Readonly<Record<string, unknown>>;
}

/**
 * Why a credential may not be a `provider` profile's subscription or gateway, or undefined when it may. `credential` is
 * the profile owner's own credential of that id, undefined when they have none (another person's is the same, so nobody
 * learns which exist): 422 `credential_not_found`, `provider_mismatch` (a subscription of another provider),
 * `credential_kind_mismatch` (a gateway that is not one), `gateway_provider_mismatch` (a gateway of the other provider)
 * or `credential_revoked`.
 */
export function credentialRefusal(
  part: ProfilePart,
  provider: ProfileProvider,
  credential: HeldCredential | undefined,
): ProfileRefusal<422> | undefined {
  const where = PART_NAMES[part];
  if (credential === undefined) {
    return refuse(422, 'credential_not_found', `No such subscription of yours for ${where}`);
  }
  if (part === 'subscription' && !fitsProvider(provider, credential.kind)) {
    const a = A_PROVIDER[provider];
    const kinds = PROVIDER_KINDS[provider].join(', ');
    return refuse(
      422,
      'provider_mismatch',
      `${capital(a)} profile takes ${a} subscription (${kinds}), not one of kind ${credential.kind}`,
    );
  }
  if (part === 'gateway' && !fitsGateway(credential.kind)) {
    return refuse(
      422,
      'credential_kind_mismatch',
      `A profile's gateway is a gateway, not one of kind ${credential.kind}`,
    );
  }
  if (part === 'gateway' && !gatewayFitsProfile(provider, credential.accountMeta)) {
    return gatewayProviderMismatch(provider);
  }
  if (credential.status === 'revoked') {
    return refuse(422, 'credential_revoked', `A revoked subscription cannot be ${where}; add it again`);
  }
  return undefined;
}

/**
 * The parts a change puts a credential in, with the credential's id: those given an id the profile does not hold there
 * already (a part keeping its credential is not checked again, so a revoked one may stay until it is replaced).
 */
export function partsPutIn(
  before: { readonly [C in PartColumn]?: string | null },
  choice: CredentialChoice,
): Array<readonly [ProfilePart, string]> {
  return (Object.keys(PART_COLUMNS) as ProfilePart[]).flatMap((part) => {
    const id = choice[PART_COLUMNS[part]];
    return typeof id === 'string' && id !== (before[PART_COLUMNS[part]] ?? null) ? [[part, id] as const] : [];
  });
}

/** The fields of a change that differ from the profile: an unchanged field writes nothing. */
export function profileChanges(
  profile: ProfileFields,
  patch: CredentialChoice & RunsChoice & { readonly name?: string | undefined },
): Partial<ProfileFields> {
  const set: Record<string, string | null> = {};
  if (patch.name !== undefined && patch.name !== profile.name) set.name = patch.name;
  for (const column of [...Object.values(PART_COLUMNS), 'model', 'effort'] as const) {
    const value = patch[column];
    if (value !== undefined && value !== profile[column]) set[column] = value;
  }
  return set as Partial<ProfileFields>;
}

/** The fields a profile's audit rows record: its owner, name, provider, the ids of its credentials, its model and effort. */
export function auditedProfile(
  row: ProfileFields & { readonly ownerUserId: string; readonly provider: ProfileProvider },
) {
  return {
    ownerUserId: row.ownerUserId,
    name: row.name,
    provider: row.provider,
    credentialId: row.credentialId,
    gatewayCredentialId: row.gatewayCredentialId,
    model: row.model,
    effort: row.effort,
  };
}

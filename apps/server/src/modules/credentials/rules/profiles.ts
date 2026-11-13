import { sameValue } from '@mwc/db';
import {
  fitsGateway,
  fitsProvider,
  fitsTool,
  PROVIDER_KINDS,
  TOOL_KINDS,
  TOOL_PROVIDERS,
} from '@mwc/shared/credentials';
import type {
  CredentialKind,
  CredentialStatus,
  Effort,
  ProfileProvider,
  ToolProvider,
} from '@mwc/shared/enums';
import { TOOL_NAMES } from './tools.ts';

// Access profiles' own rules (S3.4, one provider each since 2026-11-10, docs/subscriptions.md): what a profile's
// subscription, gateway and tool parts' sign-ins take (any of its owner's gateways: they are universal since
// 2026-11-10), what a change writes, and what the audit log keeps of a profile; which model and effort it may run is
// `profile-model.ts`'s, and what a request's tool parts write (S7.1b, one profile since 2026-11-13) `tool-parts.ts`'s.
// Who gives a profile to an agent, and to which harness it fits, is the org module's rule. Pure.

/** A profile's credentials: its subscription, its gateway, and each tool part's sign-in. */
export type ProfilePart = 'subscription' | 'gateway' | ToolProvider;

/** The column that holds each part's credential. */
const PART_COLUMNS = {
  subscription: 'credentialId',
  gateway: 'gatewayCredentialId',
  github: 'githubCredentialId',
  atlassian: 'atlassianCredentialId',
} as const satisfies Record<ProfilePart, string>;

type PartColumn = (typeof PART_COLUMNS)[ProfilePart];

/** Each tool part's rights column. */
type RightsColumn = 'githubRights' | 'atlassianRights';

/** A profile's credentials as a request gives them: a credential id, null to empty one, or left out to keep it. */
export type CredentialChoice = { readonly [C in PartColumn]?: string | null | undefined };

/** What a profile runs: a model and an effort, each null for the provider's default. */
export interface ProfileRuns {
  readonly model: string | null;
  readonly effort: Effort | null;
}

/** A profile's name, credentials, model, effort and tool parts' rights as stored. */
export type ProfileFields = { readonly name: string } & {
  readonly [C in PartColumn]: string | null;
} & ProfileRuns & { readonly [C in RightsColumn]: Readonly<Record<string, unknown>> | null };

/** A change of what a profile runs, as a request gives it: a value, null for the default, or left out to keep it. */
export type RunsChoice = { readonly [K in keyof ProfileRuns]?: ProfileRuns[K] | undefined };

/** A change of the tool parts' rights (a part's whole set, or null with the part), or left out to keep them. */
export type RightsChoice = {
  readonly [C in RightsColumn]?: Readonly<Record<string, unknown>> | null | undefined;
};

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

const isToolPart = (part: ProfilePart): part is ToolProvider =>
  (TOOL_PROVIDERS as readonly string[]).includes(part);

/** Each tool with its article, as messages show it: "a GitHub", "an Atlassian". */
const A_TOOL: Readonly<Record<ToolProvider, string>> = { github: 'a GitHub', atlassian: 'an Atlassian' };

/** What a part holds, as messages say it: a subscription, or a tool part's sign-in ("GitHub sign-in"). */
const heldName = (part: ProfilePart): string =>
  isToolPart(part) ? `${TOOL_NAMES[part]} sign-in` : 'subscription';

/** Each part as a message names it: its subscription, its gateway, its GitHub part. */
const partName = (part: ProfilePart): string => {
  if (part === 'subscription') return 'its subscription';
  return part === 'gateway' ? 'its gateway' : `its ${TOOL_NAMES[part]} part`;
};

/** What the rules read of a credential: its kind and its state. */
export interface HeldCredential {
  readonly kind: CredentialKind;
  readonly status: CredentialStatus;
}

/** Why a credential of this kind may not be in this part (422), or undefined when it may. */
function kindRefusal(part: ProfilePart, provider: ProfileProvider, kind: CredentialKind) {
  if (part === 'subscription') {
    if (fitsProvider(provider, kind)) return undefined;
    const a = A_PROVIDER[provider];
    const kinds = PROVIDER_KINDS[provider].join(', ');
    return refuse(
      422,
      'provider_mismatch',
      `${capital(a)} profile takes ${a} subscription (${kinds}), not one of kind ${kind}`,
    );
  }
  if (part === 'gateway') {
    if (fitsGateway(kind)) return undefined;
    return refuse(
      422,
      'credential_kind_mismatch',
      `A profile's gateway is a gateway, not one of kind ${kind}`,
    );
  }
  if (fitsTool(part, kind)) return undefined;
  const kinds = TOOL_KINDS[part].join(', ');
  return refuse(
    422,
    'credential_kind_mismatch',
    `A profile's ${TOOL_NAMES[part]} part takes ${A_TOOL[part]} sign-in (${kinds}), not one of kind ${kind}`,
  );
}

/**
 * Why a credential may not be in this part of a `provider` profile (its subscription, its gateway, or a tool part's
 * sign-in), or undefined when it may. `credential` is the profile owner's own credential of that id, undefined when they
 * have none (another person's is the same, so nobody learns which exist): 422 `credential_not_found`,
 * `provider_mismatch` (a subscription of another provider, or a tool sign-in as the subscription),
 * `credential_kind_mismatch` (a gateway that is not one; a tool part's sign-in of another kind than its tool's) or
 * `credential_revoked`. Any gateway fits any profile.
 */
export function credentialRefusal(
  part: ProfilePart,
  provider: ProfileProvider,
  credential: HeldCredential | undefined,
): ProfileRefusal<422> | undefined {
  const where = partName(part);
  if (credential === undefined) {
    return refuse(422, 'credential_not_found', `No such ${heldName(part)} of yours for ${where}`);
  }
  const mismatch = kindRefusal(part, provider, credential.kind);
  if (mismatch) return mismatch;
  if (credential.status === 'revoked') {
    const again = isToolPart(part) ? 'sign in again' : 'add it again';
    return refuse(422, 'credential_revoked', `A revoked ${heldName(part)} cannot be ${where}; ${again}`);
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

/** The fields of a change that differ from the profile: an unchanged field (rights equal as jsonb) writes nothing. */
export function profileChanges(
  profile: ProfileFields,
  patch: CredentialChoice & RunsChoice & RightsChoice & { readonly name?: string | undefined },
): Partial<ProfileFields> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name !== profile.name) set.name = patch.name;
  const columns = [
    ...Object.values(PART_COLUMNS),
    'model',
    'effort',
    'githubRights',
    'atlassianRights',
  ] as const;
  for (const column of columns) {
    const value = patch[column];
    if (value !== undefined && !sameValue(value, profile[column])) set[column] = value;
  }
  return set as Partial<ProfileFields>;
}

/**
 * The fields a profile's audit rows record: its owner, name, provider, the ids of its credentials, its model and effort,
 * and its tool parts' sign-ins and rights.
 */
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
    githubCredentialId: row.githubCredentialId,
    githubRights: row.githubRights,
    atlassianCredentialId: row.atlassianCredentialId,
    atlassianRights: row.atlassianRights,
  };
}

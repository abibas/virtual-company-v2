import { type AccessProfile, PROFILE_AI_COLUMNS, PROFILE_TOOL_COLUMNS, sameValue } from '@mwc/db';
import {
  fitsGateway,
  fitsProvider,
  fitsTool,
  isAiPart,
  PART_NAMES,
  PROVIDER_KINDS,
  type ProfilePart,
  TOOL_KINDS,
} from '@mwc/shared/credentials';
import type { CredentialKind, CredentialStatus, Effort, ProfileProvider } from '@mwc/shared/enums';

// Profiles' own rules (S3.4; generic since 2026-11-13, docs/subscriptions.md "Profiles"): which credential each place
// in a part takes (a part's subscription is its provider's, any gateway fits, a tool part's sign-in is its tool's),
// what a change writes and what the audit log keeps of a profile; which model and effort an AI part may run is
// `profile-model.ts`'s, and what a request's parts write `parts.ts`'s. Who gives a profile to an agent, and that it has
// the part the agent's harness runs on, is the org module's rule. Pure.

/**
 * Every column of a profile's parts: each AI part's presence, credentials, model, effort and mode; each tool part's two.
 */
export const PART_COLUMNS = [
  ...Object.values(PROFILE_AI_COLUMNS).flatMap((at) => [
    at.part,
    at.credential,
    at.gateway,
    at.model,
    at.effort,
    at.mode,
  ]),
  ...Object.values(PROFILE_TOOL_COLUMNS).flatMap((at) => [at.credential, at.rights]),
] as const;

type PartColumn = (typeof PART_COLUMNS)[number];

/** A profile's name and parts as stored. */
export type ProfileFields = Pick<AccessProfile, 'name' | PartColumn>;

/** A change of a profile's fields, each left out to keep it. */
export type ProfileChange = { -readonly [K in keyof ProfileFields]?: ProfileFields[K] };

/** Where a part holds a credential: an AI part's subscription or gateway, a tool part's sign-in. */
type Role = 'subscription' | 'gateway' | 'signIn';

/** A place in a profile that holds a credential. */
export interface CredentialSlot {
  readonly part: ProfilePart;
  readonly role: Role;
}

/** Each column that holds a credential, and its place. */
const SLOTS: ReadonlyArray<readonly [PartColumn, CredentialSlot]> = [
  ...Object.entries(PROFILE_AI_COLUMNS).flatMap(([part, at]) => [
    [at.credential, { part: part as ProfileProvider, role: 'subscription' }] as const,
    [at.gateway, { part: part as ProfileProvider, role: 'gateway' }] as const,
  ]),
  ...Object.entries(PROFILE_TOOL_COLUMNS).map(
    ([part, at]) => [at.credential, { part: part as ProfilePart, role: 'signIn' }] as const,
  ),
];

/** What a profile runs in an AI part: a model and an effort, each null for the default. */
export interface ProfileRuns {
  readonly model: string | null;
  readonly effort: Effort | null;
}

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
export const PROFILE_NOT_FOUND = refuse(404, 'access_profile_not_found', 'No such profile');

export const profileNameTaken = (name: string) =>
  refuse(409, 'access_profile_name_taken', `You have a profile named ${name} already`);

/** Each AI part's name with its article, as messages show it: "a Claude", "an OpenAI". */
export const A_PROVIDER: Readonly<Record<ProfileProvider, string>> = {
  claude: 'a Claude',
  openai: 'an OpenAI',
};

const A_PART: Readonly<Record<ProfilePart, string>> = {
  ...A_PROVIDER,
  github: 'a GitHub',
  atlassian: 'an Atlassian',
};

export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a place holds, as messages say it: "Claude subscription", "gateway", "GitHub sign-in". */
const heldName = ({ part, role }: CredentialSlot): string =>
  role === 'gateway' ? 'gateway' : `${PART_NAMES[part]} ${role === 'signIn' ? 'sign-in' : 'subscription'}`;

/** What the rules read of a credential: its kind and its state. */
export interface HeldCredential {
  readonly kind: CredentialKind;
  readonly status: CredentialStatus;
}

/** True when a credential of this kind may be in this place. */
function fits({ part, role }: CredentialSlot, kind: CredentialKind): boolean {
  if (role === 'gateway') return fitsGateway(kind);
  return isAiPart(part) ? fitsProvider(part, kind) : fitsTool(part, kind);
}

/** The kinds a place takes, as a message lists them. */
const kindsOf = ({ part, role }: CredentialSlot): string =>
  (role === 'gateway' ? ['gateway'] : isAiPart(part) ? PROVIDER_KINDS[part] : TOOL_KINDS[part]).join(', ');

/** A credential of a kind the place does not take (422 `credential_kind_mismatch`). */
function kindMismatch(slot: CredentialSlot, kind: CredentialKind): ProfileRefusal<422> {
  const name = PART_NAMES[slot.part];
  const message =
    slot.role === 'gateway'
      ? `A profile's gateway is a gateway, not one of kind ${kind}`
      : `A profile's ${name} part takes ${A_PART[slot.part]} ${slot.role === 'signIn' ? 'sign-in' : 'subscription'} (${kindsOf(slot)}), not one of kind ${kind}`;
  return refuse(422, 'credential_kind_mismatch', message);
}

/**
 * Why a credential may not be in this place of a profile (an AI part's subscription or gateway, a tool part's sign-in),
 * or undefined when it may. `credential` is the profile owner's own credential of that id, undefined when they have
 * none (another person's is the same, so nobody learns which exist): 422 `credential_not_found`,
 * `credential_kind_mismatch` (a kind the place does not take: a part's subscription is its provider's, a gateway a
 * gateway, a tool part's sign-in its tool's) or `credential_revoked`. Any gateway fits any AI part.
 */
export function credentialRefusal(
  slot: CredentialSlot,
  credential: HeldCredential | undefined,
): ProfileRefusal<422> | undefined {
  const where = `its ${PART_NAMES[slot.part]} part`;
  const held = heldName(slot);
  if (credential === undefined) {
    return refuse(422, 'credential_not_found', `No such ${held} of yours for ${where}`);
  }
  if (!fits(slot, credential.kind)) return kindMismatch(slot, credential.kind);
  if (credential.status === 'revoked') {
    const again = slot.role === 'signIn' ? 'sign in again' : 'add it again';
    return refuse(422, 'credential_revoked', `A revoked ${held} cannot be in ${where}; ${again}`);
  }
  return undefined;
}

/**
 * The places a change puts a credential in, with the credential's id: those given an id the profile does not hold there
 * already (a place keeping its credential is not checked again, so a revoked one may stay until it is replaced).
 */
export function partsPutIn(
  before: Partial<ProfileFields>,
  change: ProfileChange,
): Array<readonly [CredentialSlot, string]> {
  return SLOTS.flatMap(([column, slot]) => {
    const id = change[column];
    return typeof id === 'string' && id !== (before[column] ?? null) ? [[slot, id] as const] : [];
  });
}

/** The fields of a change that differ from the profile: an unchanged field (rights equal as jsonb) writes nothing. */
export function profileChanges(profile: ProfileFields, change: ProfileChange): ProfileChange {
  const set: Record<string, unknown> = {};
  for (const column of ['name', ...PART_COLUMNS] as const) {
    const value = change[column];
    if (value !== undefined && !sameValue(value, profile[column])) set[column] = value;
  }
  return set as ProfileChange;
}

/** The fields a profile's audit rows record: its owner, its name and every column of its parts. */
export function auditedProfile(row: ProfileFields & { readonly ownerUserId: string }) {
  const parts = Object.fromEntries(PART_COLUMNS.map((column) => [column, row[column]]));
  return { ownerUserId: row.ownerUserId, name: row.name, ...parts };
}

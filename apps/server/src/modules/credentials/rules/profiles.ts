import { fitsSlot, PROFILE_SLOTS, type ProfileSlot } from '@mwc/shared/credentials';
import type { CredentialKind, CredentialStatus } from '@mwc/shared/enums';

// Access profiles' own rules (S3.4, docs/subscriptions.md): what a slot takes, what a change writes, and what the audit
// log keeps of a profile. Who gives a profile to an agent is the org module's rule. Pure.

/** The column that holds each slot's credential. */
export const SLOT_COLUMNS = {
  claude: 'claudeCredentialId',
  openai: 'openaiCredentialId',
  gateway: 'gatewayCredentialId',
} as const satisfies Record<ProfileSlot, string>;

export type SlotColumn = (typeof SLOT_COLUMNS)[ProfileSlot];

/** A profile's slots as a request gives them: a credential id, null to empty one, or left out to keep it. */
export type SlotChoice = { readonly [C in SlotColumn]?: string | null | undefined };

/** A profile's name and slots as stored. */
export type ProfileFields = { readonly name: string } & { readonly [C in SlotColumn]: string | null };

type RefusalStatus = 404 | 409 | 422;

/** A refusal the profile routes answer in the common error shape, typed by its status so each route documents it. */
export interface ProfileRefusal<S extends RefusalStatus = RefusalStatus> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

const refuse = <S extends RefusalStatus>(status: S, code: string, message: string): ProfileRefusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

/** Another person's profile, or no such id: the same 404, as for subscriptions. */
export const PROFILE_NOT_FOUND = refuse(404, 'access_profile_not_found', 'No such access profile');

export const profileNameTaken = (name: string) =>
  refuse(409, 'access_profile_name_taken', `You have an access profile named ${name} already`);

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const SLOT_NAMES: Readonly<Record<ProfileSlot, string>> = {
  claude: 'the Claude slot',
  openai: 'the OpenAI slot',
  gateway: 'the gateway slot',
};

/**
 * Why a credential may not go in a slot, or undefined when it may. `credential` is the profile owner's own credential
 * of that id, undefined when they have none (another person's is the same, so nobody learns which exist): 422
 * `credential_not_found`, `credential_kind_mismatch` (a kind the slot does not take) or `credential_revoked`.
 */
export function slotRefusal(
  slot: ProfileSlot,
  credential: { readonly kind: CredentialKind; readonly status: CredentialStatus } | undefined,
): ProfileRefusal<422> | undefined {
  const where = SLOT_NAMES[slot];
  if (credential === undefined)
    return refuse(422, 'credential_not_found', `No such subscription of yours for ${where}`);
  if (!fitsSlot(slot, credential.kind)) {
    return refuse(
      422,
      'credential_kind_mismatch',
      `${capital(where)} does not take a subscription of kind ${credential.kind}`,
    );
  }
  if (credential.status === 'revoked') {
    return refuse(422, 'credential_revoked', `A revoked subscription cannot go in ${where}; add it again`);
  }
  return undefined;
}

/**
 * The slots a change puts a credential in, with the credential's id: those given an id the profile does not hold
 * there already (a slot keeping its credential is not checked again, so a revoked one may stay until it is replaced).
 */
export function slotsPutIn(
  before: { readonly [C in SlotColumn]?: string | null },
  choice: SlotChoice,
): Array<readonly [ProfileSlot, string]> {
  return PROFILE_SLOTS.flatMap((slot) => {
    const id = choice[SLOT_COLUMNS[slot]];
    return typeof id === 'string' && id !== (before[SLOT_COLUMNS[slot]] ?? null) ? [[slot, id] as const] : [];
  });
}

/** The fields of a change that differ from the profile: an unchanged field writes nothing. */
export function profileChanges(
  profile: ProfileFields,
  patch: SlotChoice & { readonly name?: string | undefined },
): Partial<ProfileFields> {
  const set: Record<string, string | null> = {};
  if (patch.name !== undefined && patch.name !== profile.name) set.name = patch.name;
  for (const column of Object.values(SLOT_COLUMNS)) {
    const value = patch[column];
    if (value !== undefined && value !== profile[column]) set[column] = value;
  }
  return set as Partial<ProfileFields>;
}

/** The fields a profile's audit rows record: its owner, name and the ids of its slots' credentials. */
export function auditedProfile(row: ProfileFields & { readonly ownerUserId: string }) {
  return {
    ownerUserId: row.ownerUserId,
    name: row.name,
    claudeCredentialId: row.claudeCredentialId,
    openaiCredentialId: row.openaiCredentialId,
    gatewayCredentialId: row.gatewayCredentialId,
  };
}

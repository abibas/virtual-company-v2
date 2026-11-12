import { isToolProvider, rightsProviderOf, type ToolRights } from '@mwc/shared/credentials';
import type { Effort, ProfileProvider } from '@mwc/shared/enums';
import { A_PROVIDER, capital, type ProfileRefusal, refuse } from './profiles.ts';

// Tool profiles' own rules (S7.1b, docs/subscriptions.md "Tool profiles"): a GitHub or Atlassian profile holds one sign-in
// of its tool and the rights its agents have there, and has no gateway, model or effort; an AI profile has no rights.
// Which sign-in fits is `credentialRefusal`'s (`profiles.ts`), the rights' shape `@mwc/shared/credentials`'. Pure.

const TOOL_NAMES = { github: 'GitHub', atlassian: 'Atlassian' } as const;

/** What a request gives a profile besides its name and credential: a gateway, a model, an effort, rights. */
export interface PartsChoice {
  readonly gatewayCredentialId?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly effort?: Effort | null | undefined;
  readonly rights?: ToolRights | undefined;
}

/**
 * Why a change gives a `provider` profile a part it does not have, or undefined when it does not: a gateway, a model or
 * an effort on a tool profile (422 `not_for_tool_profile`; null, what it holds anyway, is fine), rights on an AI profile
 * (422 `rights_not_for_ai_profile`), or the other tool's rights (422 `rights_provider_mismatch`).
 */
export function partsRefusal(
  provider: ProfileProvider,
  choice: PartsChoice,
): ProfileRefusal<422> | undefined {
  const { rights } = choice;
  if (!isToolProvider(provider)) {
    if (rights === undefined) return undefined;
    return refuse(
      422,
      'rights_not_for_ai_profile',
      `${capital(A_PROVIDER[provider])} profile has no rights: only GitHub and Atlassian profiles do`,
    );
  }
  const extra = (['gatewayCredentialId', 'model', 'effort'] as const).some(
    (part) => choice[part] !== undefined && choice[part] !== null,
  );
  if (extra) {
    return refuse(
      422,
      'not_for_tool_profile',
      `${capital(A_PROVIDER[provider])} profile has no gateway, model or effort: it holds ${A_PROVIDER[provider]} sign-in and its rights`,
    );
  }
  if (rights !== undefined && rightsProviderOf(rights) !== provider) {
    const other = rightsProviderOf(rights);
    return refuse(
      422,
      'rights_provider_mismatch',
      `${capital(A_PROVIDER[provider])} profile takes ${TOOL_NAMES[provider]}'s rights, not ${TOOL_NAMES[other]}'s`,
    );
  }
  return undefined;
}

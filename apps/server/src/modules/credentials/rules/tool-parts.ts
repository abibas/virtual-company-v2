import { PROFILE_TOOL_COLUMNS } from '@mwc/db';
import {
  type AtlassianRights,
  defaultRights,
  type GitHubRights,
  TOOL_PROVIDERS,
} from '@mwc/shared/credentials';
import type { ToolProvider } from '@mwc/shared/enums';

// A profile's tool parts (S7.1b, one profile with tool parts since 2026-11-13, docs/subscriptions.md "Tool parts"): what
// a request's `tools` write to the profile's columns. Which sign-in a part takes is `credentialRefusal`'s
// (`profiles.ts`), the rights' shape `@mwc/shared/credentials`' (the request's schema parses them). Pure.

/** One part as a request gives it: its sign-in (an id, null for none, left out to keep it) and its whole rights. */
interface PartChoice<R> {
  readonly credentialId?: string | null | undefined;
  readonly rights?: R | undefined;
}

/** A profile's tool parts as a request gives them: a part to add or change, null to remove it, or left out to keep it. */
export interface ToolPartsChoice {
  readonly github?: PartChoice<GitHubRights> | null | undefined;
  readonly atlassian?: PartChoice<AtlassianRights> | null | undefined;
}

type Columns = (typeof PROFILE_TOOL_COLUMNS)[ToolProvider];

/** A profile's tool part columns as stored: each part's sign-in and its rights (null rights: no such part). */
export type ToolFields = { readonly [C in Columns['credential']]: string | null } & {
  readonly [C in Columns['rights']]: Readonly<Record<string, unknown>> | null;
};

/** What a change writes to the tool part columns. */
export type ToolSet = { -readonly [C in keyof ToolFields]?: ToolFields[C] };

/**
 * The columns a request's tool parts write, on a profile as stored (none for a new one): a part removed (null) empties
 * both its columns, when the profile has it; a part added takes the sign-in given (none when left out) and the rights
 * given (its tool's safe defaults when left out); a part changed takes the sign-in and the rights given, keeping what is
 * left out. A part left out writes nothing. `profileChanges` then drops what equals the stored values.
 */
export function toolColumns(before: ToolFields | undefined, tools: ToolPartsChoice | undefined): ToolSet {
  const set: Record<string, unknown> = {};
  for (const tool of TOOL_PROVIDERS) {
    const choice = tools?.[tool];
    if (choice === undefined) continue;
    const columns = PROFILE_TOOL_COLUMNS[tool];
    const has = before !== undefined && before[columns.rights] !== null;
    if (choice === null) {
      if (has) Object.assign(set, { [columns.credential]: null, [columns.rights]: null });
      continue;
    }
    if (choice.credentialId !== undefined || !has) set[columns.credential] = choice.credentialId ?? null;
    if (choice.rights !== undefined || !has) set[columns.rights] = choice.rights ?? defaultRights(tool);
  }
  return set as ToolSet;
}

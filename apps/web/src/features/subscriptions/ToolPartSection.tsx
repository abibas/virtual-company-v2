import type { ToolRights } from '@mwc/shared/credentials';
import type { ToolProvider } from '@mwc/shared/enums';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfileChanges } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { type CardProps, PartFrame, SavedSelect } from './ProfileParts.tsx';
import { PART_STYLES } from './Providers.tsx';
import { signInOptions } from './profile-options.ts';
import { ToolRightsFields } from './ToolRightsFields.tsx';

type Part = NonNullable<CardProps['profile']['parts'][ToolProvider]>;

/** A change of one tool part, as `PATCH` takes it: its sign-in or rights, or null to remove the part. */
export const toolPartChange = (
  tool: ToolProvider,
  part: Record<string, unknown> | null,
): AccessProfileChanges => ({ parts: { [tool]: part } }) as AccessProfileChanges;

/** The part's rights, each change saved at once as the whole set; a refusal shows under them and puts them back. */
function SavedRights({
  tool,
  part,
  update,
}: {
  readonly tool: ToolProvider;
  readonly part: Part;
  readonly update: CardProps['update'];
}) {
  const [rights, setRights] = useState<ToolRights>(part.rights);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = async (next: ToolRights) => {
    setRights(next);
    setBusy(true);
    setError(undefined);
    try {
      await update(toolPartChange(tool, { rights: next }));
    } catch (failure) {
      setRights(part.rights);
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <ToolRightsFields rights={rights} onChange={(next) => void change(next)} disabled={busy} />
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A profile's GitHub or Atlassian part on its card (S7.1b, generic profiles since 2026-11-13): its sign-in and its rights,
 * each saved as it changes, and Remove.
 */
export function ToolPartSection({
  tool,
  part,
  subscriptions,
  update,
}: Pick<CardProps, 'subscriptions' | 'update'> & { readonly tool: ToolProvider; readonly part: Part }) {
  const { name, icon } = PART_STYLES[tool];
  const addSignInHref = usePersonalHref('subscriptions');
  const options = signInOptions(tool, subscriptions, part.signIn);
  return (
    <PartFrame name={name} icon={icon} onRemove={() => update(toolPartChange(tool, null))}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SavedSelect
          label="Sign-in"
          hint={
            options.length <= 1 && (
              <Link to={addSignInHref} className="font-semibold text-blue hover:underline">
                Add a sign-in
              </Link>
            )
          }
          value={part.signIn?.id ?? ''}
          options={options}
          save={(credentialId) => update(toolPartChange(tool, { credentialId }))}
        />
      </div>
      <SavedRights key={JSON.stringify(part.rights)} tool={tool} part={part} update={update} />
    </PartFrame>
  );
}

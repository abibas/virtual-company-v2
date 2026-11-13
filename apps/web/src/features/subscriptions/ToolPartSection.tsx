import type { ToolRights } from '@mwc/shared/credentials';
import type { ToolProvider } from '@mwc/shared/enums';
import { type LucideIcon, Plus } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { AccessProfileChanges } from '../../api/types.ts';
import { usePersonalHref } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { Button } from '../../components/ui/Button.tsx';
import type { CardProps } from './ProfileParts.tsx';
import { SavedSelect } from './ProfileParts.tsx';
import { TOOL_STYLES } from './Providers.tsx';
import { firstSignIn, signInOptions } from './profile-options.ts';
import { ToolRightsFields } from './ToolRightsFields.tsx';

type Part = NonNullable<CardProps['profile']['tools'][ToolProvider]>;

/** A change of one tool part, as `PATCH` takes it: the part (its sign-in, its rights) or null to remove it. */
const partChange = (tool: ToolProvider, part: Record<string, unknown> | null): AccessProfileChanges =>
  ({ tools: { [tool]: part } }) as AccessProfileChanges;

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
      await update(partChange(tool, { rights: next }));
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

/** A button that saves a change of the part, busy while it goes, with its refusal beside it. */
function PartButton({
  label,
  icon,
  run,
}: {
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly run: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const click = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await run();
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs font-medium text-failed">
          {error}
        </span>
      )}
      <Button size="sm" tone="quiet" {...(icon ? { icon } : {})} busy={busy} onClick={() => void click()}>
        {label}
      </Button>
    </span>
  );
}

/**
 * One tool part of a profile's card (S7.1b, one profile since 2026-11-13): "None" with Add GitHub (or Atlassian), which
 * adds the part with the person's first sign-in of that tool and its safe rights; or its sign-in and its rights, each
 * saved at once, and Remove.
 */
export function ToolPartSection({
  tool,
  profile,
  subscriptions,
  update,
}: Omit<CardProps, 'remove'> & { readonly tool: ToolProvider }) {
  const { name, icon: Icon } = TOOL_STYLES[tool];
  const part = profile.tools[tool];
  const addSignInHref = usePersonalHref('subscriptions');
  const options = signInOptions(tool, subscriptions, part?.signIn ?? null);
  return (
    <section aria-label={name} className="flex flex-col gap-3 rounded-xl border border-line px-3 py-2.5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon size={16} aria-hidden="true" />
          {name}
          {part === null && <span className="font-normal text-dim">None</span>}
        </span>
        {part === null ? (
          <PartButton
            label={`Add ${name}`}
            icon={Plus}
            run={() => update(partChange(tool, { credentialId: firstSignIn(tool, subscriptions) }))}
          />
        ) : (
          <PartButton label="Remove" run={() => update(partChange(tool, null))} />
        )}
      </header>
      {part !== null && (
        <>
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
              save={(credentialId) => update(partChange(tool, { credentialId }))}
            />
          </div>
          <SavedRights key={JSON.stringify(part.rights)} tool={tool} part={part} update={update} />
        </>
      )}
    </section>
  );
}

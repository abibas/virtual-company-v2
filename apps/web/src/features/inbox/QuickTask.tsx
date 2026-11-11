import { TASK_TITLE } from '@mwc/shared/flows';
import { ArrowUp } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { Link } from '../../app/router.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import { LeadChips, type QuickMade, type QuickTeam } from './LeadChips.tsx';

export type { QuickMade, QuickTeam };

/** The title and the send button: Queued, or the first step for those who lead the team. */
function TitleField({
  id,
  title,
  busy,
  team,
  onChange,
}: {
  readonly id: string;
  readonly title: string;
  readonly busy: boolean;
  readonly team: QuickTeam | undefined;
  readonly onChange: (title: string) => void;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Title
      </label>
      <input
        id={id}
        value={title}
        maxLength={TASK_TITLE.max}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        placeholder={team ? `A task for ${team.flowName}` : 'A task'}
        className="h-9 min-w-0 flex-1 rounded-full bg-surface px-3.5 text-sm text-ink ring-1 ring-line ring-inset outline-none placeholder:text-faint focus:ring-blue disabled:opacity-60"
      />
      <IconButton
        type="submit"
        label={team?.leads ? 'Create it in the first step' : 'Create it in Queued'}
        icon={ArrowUp}
        tone="primary"
        round
        disabled={busy || title.trim() === ''}
      />
    </div>
  );
}

/** A send in flight: busy, the task it made, the refusal's words, and the send itself (it clears the title). */
function useQuickSend(onCreate: (team: QuickTeam, title: string) => Promise<QuickMade>) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<QuickMade>();
  const [error, setError] = useState<string>();
  const send = async (team: QuickTeam | undefined) => {
    const words = title.trim();
    if (!team || words === '' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setMade(await onCreate(team, words));
      setTitle('');
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { title, setTitle, busy, made, error, send };
}

/**
 * The dock at the foot of the Attention view (S6b): pick a team by its Lead's chip, give the task a title, send. The
 * task waits in the team's Queued, or goes straight into the first step for those who lead the team (`onCreate` decides);
 * the made task's key then links to it. No team flows: one line pointing at the flows.
 */
export function QuickTask({
  teams,
  companyId,
  onCreate,
  taskHref,
  flowsHref,
}: {
  readonly teams: readonly QuickTeam[];
  readonly companyId: string;
  readonly onCreate: (team: QuickTeam, title: string) => Promise<QuickMade>;
  readonly taskHref: (key: string) => string;
  readonly flowsHref: string;
}) {
  const id = useId();
  const [picked, setPicked] = useState<string>();
  const team = teams.find((t) => t.flowId === picked) ?? teams[0];
  const quick = useQuickSend(onCreate);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void quick.send(team);
  };
  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`} className="rounded-xl bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${id}-title`} className="text-sm font-bold text-ink">
          Quick create task
        </h3>
        {quick.made && (
          <Link
            to={taskHref(quick.made.key)}
            className="truncate text-xs font-semibold text-blue hover:underline"
          >
            {quick.made.key} · {quick.made.where}
          </Link>
        )}
      </div>
      {teams.length === 0 ? (
        <p className="mt-2 text-xs text-dim">
          No team flows yet.{' '}
          <Link to={flowsHref} className="font-semibold text-blue hover:underline">
            Create one
          </Link>
        </p>
      ) : (
        <>
          <LeadChips teams={teams} team={team} companyId={companyId} onPick={setPicked} />
          <TitleField
            id={`${id}-text`}
            title={quick.title}
            busy={quick.busy}
            team={team}
            onChange={quick.setTitle}
          />
        </>
      )}
      {quick.error && (
        <p role="alert" className="mt-2 text-xs text-failed">
          {quick.error}
        </p>
      )}
    </form>
  );
}

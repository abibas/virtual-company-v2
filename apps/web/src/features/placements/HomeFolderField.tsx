import { PLACEMENT_PATH } from '@mwc/shared/machines';
import { CONTAINER_WORK_ROOT } from '@mwc/shared/runner-protocol';
import { FolderOpen } from 'lucide-react';
import { useId, useState } from 'react';
import { useFolderStart } from '../../api/folders.ts';
import type { FolderList, MachineChoice } from '../../api/types.ts';
import { Field } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { FolderBrowser } from './FolderBrowser.tsx';
import { suggestedHome } from './folder-path.ts';
import type { PlacementDraft } from './placement-draft.ts';

/** The suggested home folder: in the runner's agents folder, or in /work for a container before its runner answers. */
function suggestionOf(start: FolderList | null | undefined, kind: string | undefined, slug: string) {
  if (start) return suggestedHome(start.agentsRoot, slug);
  return kind === 'container' ? suggestedHome(CONTAINER_WORK_ROOT, slug) : undefined;
}

export interface HomeFolderFieldProps {
  readonly draft: PlacementDraft;
  readonly companyId: string;
  /** The chosen machine, once the machines loaded. */
  readonly machine: MachineChoice | undefined;
  /** The agent's slug: the suggested folder's name. */
  readonly agentSlug: string;
  readonly readOnly: boolean;
}

/**
 * The home folder: typed, or chosen with Browse… from the machine's own folders (a Docker runner's work volume, /work).
 * While it is empty, the default for the agent is suggested (`~/agents/<slug>` on the machine, `/work/<slug>` in a
 * container) with "Use suggested".
 */
export function HomeFolderField({ draft, companyId, machine, agentSlug, readOnly }: HomeFolderFieldProps) {
  const id = useId();
  const [browsing, setBrowsing] = useState(false);
  const { values, set } = draft;
  const home = values.home.trim();
  const start = useFolderStart(companyId, values.machineId, home === '' && !readOnly);
  const suggestion =
    home === '' && !readOnly ? suggestionOf(start.data, machine?.kind, agentSlug) : undefined;
  const error = home !== '' && !draft.valid ? 'Give an absolute path, starting with /.' : undefined;
  const hint = suggestion ? (
    <>
      Suggested: <span className="font-mono text-ink-2">{suggestion}</span>{' '}
      <button
        type="button"
        onClick={() => set('home', suggestion)}
        className="font-semibold text-blue hover:underline"
      >
        Use suggested
      </button>
    </>
  ) : undefined;
  return (
    <Field label="Home folder" id={id} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={values.home}
          onChange={(event) => set('home', event.target.value)}
          readOnly={readOnly}
          required
          maxLength={PLACEMENT_PATH.max}
          spellCheck={false}
          placeholder={machine?.kind === 'container' ? '/work/scout' : '/Users/you/agents/scout'}
          aria-describedby={[`${id}-hint`, error ? `${id}-error` : ''].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
        />
        {!readOnly && (
          <Button icon={FolderOpen} onClick={() => setBrowsing(true)}>
            Browse…
          </Button>
        )}
      </div>
      {!readOnly && (
        <FolderBrowser
          open={browsing}
          onClose={() => setBrowsing(false)}
          companyId={companyId}
          machineId={values.machineId}
          machineName={machine?.name ?? draft.saved?.machineName ?? 'the machine'}
          start={values.home}
          onChoose={(path) => set('home', path)}
        />
      )}
    </Field>
  );
}

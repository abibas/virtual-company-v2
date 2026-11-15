import { useState } from 'react';
import { useSprint, useSprints } from '../../../api/flows.ts';
import { LoadState } from '../../../components/data/LoadState.tsx';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import type { FlowLinks } from '../links.ts';
import { SprintsView } from './SprintsView.tsx';

/** The chosen sprint's report, read live. */
function Report({
  companyId,
  flowId,
  sprintId,
  ...view
}: {
  readonly companyId: string;
  readonly flowId: string;
  readonly sprintId: string;
} & Omit<Parameters<typeof SprintsView>[0], 'report' | 'selected'>) {
  const report = useSprint(companyId, flowId, sprintId);
  return <SprintsView {...view} selected={sprintId} report={report} />;
}

/**
 * The Sprints tab on the company's data (T-37): the flow's sprints and the chosen one's report (the current sprint
 * until another is chosen). `version` is the board's current sprint, so a new sprint reads the list again.
 */
export function LiveSprints({
  companyId,
  flowId,
  flowName,
  version,
  links,
}: {
  readonly companyId: string;
  readonly flowId: string;
  readonly flowName: string;
  readonly version: string;
  readonly links: FlowLinks;
}) {
  const sprints = useSprints(companyId, flowId, version);
  const [chosen, setChosen] = useState<string>();
  return (
    <LoadState
      loaded={sprints}
      label="Loading the sprints…"
      skeleton={<Skeleton className="h-64 rounded-2xl" />}
    >
      {({ sprints: list }) => {
        const sprintId = list.some((sprint) => sprint.id === chosen) ? chosen : list[0]?.id;
        const view = { sprints: list, onSelect: setChosen, flowName, links };
        if (sprintId === undefined) return <SprintsView {...view} selected={undefined} report={undefined} />;
        return <Report key={sprintId} companyId={companyId} flowId={flowId} sprintId={sprintId} {...view} />;
      }}
    </LoadState>
  );
}

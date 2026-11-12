import type { MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import { useReportChats } from '../../api/report-chats.ts';
import type { AgentRef } from '../../components/feed/kinds.ts';
import type { RightRailProps } from '../../components/layout/RightRail.tsx';
import type { DockMode } from './DockedChats.tsx';
import { type DockOverride, LiveDockedChats } from './LiveDockedChats.tsx';
import { ReportStrip } from './ReportStrip.tsx';
import { lastAgent, rememberAgent, useSeenMarks } from './seen.ts';
import { railReports, waitingCount } from './standing.ts';

/** Who is looking: what the rail's chats need of the page's membership. */
export interface ReportViewer {
  readonly companyId: string;
  readonly slug: string;
  readonly role: MembershipRole;
  /** The company's agents' icons by principal. */
  readonly faces: ReadonlyMap<string, AgentRef>;
}

/**
 * The right rail's chats with the viewer's direct reports (docs/harness.md "Your direct reports in the rail"), live: the
 * strip's faces under the inbox and the bell, and the Chats view with the open agent's chat; nothing while they have no
 * direct reports who are agents (or read no chats: viewers). The agent open last is remembered per company in this
 * browser; a click on a face opens its main chat.
 */
export function useReportRail(viewer: ReportViewer): Pick<RightRailProps, 'chats' | 'chatsCount' | 'strip'> {
  const { companyId, slug, role } = viewer;
  const loaded = useReportChats(companyId, roleAtLeast(role, 'member'));
  useSeenMarks();
  const reports = railReports(loaded.data?.reports ?? [], viewer.faces);
  const [picked, setPicked] = useState(() => lastAgent(companyId));
  const [mode, setMode] = useState<DockMode>('main');
  const [override, setOverride] = useState<DockOverride>();
  if (reports.length === 0) return {};
  const selected = reports.find((r) => r.report.agent.id === picked) ?? reports[0];
  const pick = (agentId: string) => {
    setPicked(agentId);
    rememberAgent(companyId, agentId);
    if (agentId !== selected?.report.agent.id) setMode('main');
  };
  return {
    chats: (
      <LiveDockedChats
        companyId={companyId}
        slug={slug}
        admin={roleAtLeast(role, 'admin')}
        reports={reports}
        selected={selected}
        onPick={pick}
        mode={selected?.report.team ? mode : 'main'}
        onMode={setMode}
        override={override}
        onOverride={setOverride}
        onChanged={loaded.reload}
      />
    ),
    chatsCount: waitingCount(reports),
    strip: (open) => (
      <ReportStrip
        reports={reports}
        onPick={(agentId) => {
          pick(agentId);
          open('chats');
        }}
        onMore={() => open('chats')}
      />
    ),
  };
}

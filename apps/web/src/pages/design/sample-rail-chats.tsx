import { useState } from 'react';
import { PublicConfigContext } from '../../api/config.ts';
import { ApiContext } from '../../api/context.ts';
import type { ReportChat } from '../../api/report-chats.ts';
import type { AgentRef } from '../../components/feed/kinds.ts';
import type { RightRailProps } from '../../components/layout/RightRail.tsx';
import { Composer } from '../../features/chats/Composer.tsx';
import { threadAuthors } from '../../features/chats/thread/authors.ts';
import { ChatThread } from '../../features/chats/thread/ChatThread.tsx';
import { DockedChats, type DockMode } from '../../features/report-chats/DockedChats.tsx';
import { ReportStrip } from '../../features/report-chats/ReportStrip.tsx';
import type { RailReport, ReportDot } from '../../features/report-chats/standing.ts';
import { RoomFaces, RoomView } from '../../features/room/RoomView.tsx';
import { sampleTurns } from './flows/conversation-sample.ts';
import { NO_EARLIER, SAMPLE_CONFIG } from './flows/SampleThread.tsx';
import { sampleComposerParts } from './gallery/Composers.tsx';
import { SAMPLE_NODES } from './org-sample.ts';
import { SAMPLE_SESSION, sampleApi } from './records.ts';
import { SAMPLE_AGENTS } from './sample.ts';
import { SAMPLE_ROOM } from './team-chat-sample.ts';

/** A sample direct report: the agent, a Lead's team, and its dot. */
function sample(agent: AgentRef, dot: ReportDot, team?: string): RailReport {
  const report: ReportChat = {
    agent: {
      id: agent.id,
      principalId: `p-${agent.id}`,
      name: agent.name,
      slug: agent.id,
      roleTitle: agent.role ?? 'Agent',
      status: 'active',
    },
    team: team ? { flowId: `f-${agent.id}`, name: team, chatId: null } : null,
    chat: { id: `c-${agent.id}`, title: 'A sample chat', updatedAt: '2026-11-04T09:00:00.000Z' },
    lastTurn: { status: dot === 'working' ? 'running' : 'done', at: '2026-11-04T09:00:00.000Z' },
    working: dot === 'working',
    question: dot === 'question',
    replyAt: '2026-11-04T09:00:00.000Z',
    messageAt: '2026-11-04T08:58:00.000Z',
  };
  return { report, face: agent, dot };
}

const [scout, mason, juno, pip, vega] = SAMPLE_AGENTS as [AgentRef, AgentRef, AgentRef, AgentRef, AgentRef];

/** The gallery's direct reports: a Lead first (a reply waiting), then by name, each kind of dot once. */
export const SAMPLE_REPORTS: readonly RailReport[] = [
  sample(vega, 'unseen', 'DEVBOX delivery'),
  sample(juno, 'question'),
  sample(mason, 'working'),
  sample(pip, null),
  sample(scout, null),
];

const refuse = () => Promise.reject(new Error('Sample data: nothing is sent here'));

/** A Lead's team room in the rail, on samples: who is in it, the feed, and a composer that sends nothing. */
function SampleRoom() {
  const { members } = SAMPLE_ROOM;
  return (
    <>
      <div className="px-2 pt-2">
        <RoomFaces members={[...members.agents, ...members.people]} nodes={SAMPLE_NODES} />
      </div>
      <RoomView dense room={SAMPLE_ROOM} nodes={SAMPLE_NODES} reader={SAMPLE_SESSION.user} onSend={refuse} />
    </>
  );
}

/** A sample chat in the rail (a Lead's team room, else the Develop conversation's turns); its composer sends nothing. */
function SampleDockBody({ face, team }: { readonly face: AgentRef; readonly team: boolean }) {
  const [api] = useState(sampleApi);
  if (team) return <SampleRoom />;
  const turns = sampleTurns('c-12-dev');
  const name = face.name;
  const authors = threadAuthors({ agent: face, nodes: SAMPLE_NODES, reader: SAMPLE_SESSION.user });
  return (
    <ApiContext value={api}>
      <PublicConfigContext value={SAMPLE_CONFIG}>
        <ChatThread
          dense
          turns={turns}
          agentName={name}
          authors={authors}
          chatInit={{ model: 'claude-opus-5-5', effort: 'high' }}
          answering={undefined}
          history={{ live: NO_EARLIER, folds: { loaded: new Map(), load: () => undefined } }}
        />
        <Composer
          dense
          running={false}
          choices={undefined}
          disabled={undefined}
          placeholder={`Message ${name}`}
          onSend={refuse}
          onStop={refuse}
          {...sampleComposerParts(20_400)}
        />
      </PublicConfigContext>
    </ApiContext>
  );
}

/**
 * The right rail's chats with the direct reports on samples, for the gallery's mock pages: the strip's faces and the
 * Chats view (a face opens its chat; New chat and Open full chat do nothing here). `empty`: no direct reports.
 */
export function useSampleRailChats(empty: boolean): Pick<RightRailProps, 'chats' | 'chatsCount' | 'strip'> {
  const [picked, setPicked] = useState(vega.id);
  const [mode, setMode] = useState<DockMode>('main');
  if (empty) return {};
  const selected = SAMPLE_REPORTS.find((r) => r.report.agent.id === picked);
  const pick = (id: string) => {
    setPicked(id);
    setMode('main');
  };
  return {
    chats: (
      <DockedChats
        reports={SAMPLE_REPORTS}
        selected={selected}
        onPick={pick}
        mode={mode}
        onMode={setMode}
        fullHref="/design/pages"
        onNew={() => undefined}
        body={
          selected && (
            <SampleDockBody
              key={`${picked}:${mode}`}
              face={selected.face}
              team={mode === 'team' && selected.report.team !== null}
            />
          )
        }
      />
    ),
    chatsCount: SAMPLE_REPORTS.filter((r) => r.dot === 'question' || r.dot === 'unseen').length,
    strip: (open) => (
      <ReportStrip
        reports={SAMPLE_REPORTS}
        onPick={(id) => {
          pick(id);
          open('chats');
        }}
        onMore={() => open('chats')}
      />
    ),
  };
}

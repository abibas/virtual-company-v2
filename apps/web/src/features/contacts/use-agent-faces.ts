import { useMemo } from 'react';
import { useCompany } from '../../app/company.ts';
import type { AgentIconSubject } from '../../components/feed/AgentIcon.tsx';

/**
 * An agent's face for the contacts' pages (2026-11-14): from the company's team (its icon, face and status), else by its
 * name alone (an archived agent is not in the team).
 */
export function useAgentFaces(): (agent: { readonly id: string; readonly name: string }) => AgentIconSubject {
  const { agents } = useCompany();
  const byId = useMemo(
    () => new Map((agents.data?.agents ?? []).map((agent) => [agent.id, agent])),
    [agents.data],
  );
  return (ref) => {
    const agent = byId.get(ref.id);
    if (agent === undefined) return { name: ref.name };
    return { id: agent.id, name: agent.name, face: agent.face, icon: agent.icon, status: agent.status };
  };
}

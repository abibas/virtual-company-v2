/**
 * The task commands' test world: the org commands' world (`orgWorld`: Acme with Olga, the owner whose key the commands
 * use, Bob the admin, the agents SLOP BOX and Reviewer) and a flow led by SLOP BOX, made through the API: Develop
 * (SLOP BOX), Code review (Reviewer, back to Develop, limit 1) and Approve (Bob's sign-off).
 */
import { type OrgWorld, orgWorld } from './org.ts';

export interface TasksWorld extends OrgWorld {
  readonly flowId: string;
}

export async function tasksWorld(): Promise<TasksWorld> {
  const w = await orgWorld();
  const { slop, reviewer, bob } = w.principals;
  const steps = [
    { name: 'Develop', kind: 'work', assigneePrincipalId: slop },
    {
      name: 'Code review',
      kind: 'check',
      assigneePrincipalId: reviewer,
      sendsBackTo: 'Develop',
      sendBackLimit: 1,
    },
    { name: 'Approve', kind: 'signoff', assigneePrincipalId: bob, sendsBackTo: 'Develop' },
  ];
  const res = await w.t.app.request(`/api/companies/${w.company.id}/flows`, {
    method: 'POST',
    headers: { authorization: `Bearer ${w.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ leadPrincipalId: slop, name: 'DEVBOX delivery', steps }),
  });
  if (res.status !== 201) throw new Error(`POST flows answered ${res.status}: ${await res.text()}`);
  return { ...w, flowId: ((await res.json()) as { id: string }).id };
}

import { describe, expect, it } from 'vitest';
import type { Agent, AgentNode, OrgChart, PersonNode, TreeEntry } from '../../src/api/org.ts';
import {
  agentsText,
  alignRows,
  chartText,
  managerLabel,
  nodeLabel,
  nodeName,
  principalNames,
  treeLines,
} from '../../src/org/render.ts';

const ACME = { companyId: 'c1', slug: 'acme', name: 'Acme' };

const person = (
  principalId: string,
  reportsTo: string | null,
  displayName: string,
  title: string | null = null,
) =>
  ({
    principalId,
    reportsTo,
    title,
    kind: 'person',
    person: { userId: `u-${principalId}`, displayName, email: `${principalId}@acme.test`, role: 'member' },
  }) satisfies PersonNode;

const agentNode = (principalId: string, reportsTo: string | null, name: string) =>
  ({
    principalId,
    reportsTo,
    title: null,
    kind: 'agent',
    agent: {
      agentId: `a-${principalId}`,
      name,
      slug: name.toLowerCase(),
      roleTitle: 'Coder',
      status: 'active',
      face: 3,
      model: 'claude-opus-5-5',
      effort: 'max',
    },
  }) satisfies AgentNode;

const entry = (principalId: string, children: TreeEntry[] = [], orphan = false): TreeEntry => ({
  principalId,
  kind: 'person',
  orphan,
  children,
});

const agent = (fields: Partial<Agent>): Agent => ({
  id: 'a1',
  principalId: 'p-a1',
  name: 'SLOP BOX',
  slug: 'slop-box',
  roleTitle: 'Coder',
  status: 'active',
  harness: 'claude_code',
  model: 'claude-opus-5-5',
  effort: 'high',
  instructionsRev: 1,
  maxConcurrentRuns: 1,
  face: 0,
  reportsTo: null,
  title: null,
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...fields,
});

describe('the org chart as text', () => {
  it('names people by their display name, else their email, and agents by their name', () => {
    expect(nodeName(person('p1', null, '  '))).toBe('p1@acme.test');
    expect(nodeName(person('p1', null, 'Olga'))).toBe('Olga');
    expect(nodeName(agentNode('p2', 'p1', 'SLOP BOX'))).toBe('SLOP BOX');
  });

  it('labels a person with their title and role, an agent with ◆ and its setup, and an id missing from the nodes', () => {
    expect(nodeLabel(person('p1', null, 'Olga', 'CEO'), entry('p1'))).toBe('Olga · CEO · member');
    expect(nodeLabel(agentNode('p2', null, 'Ana'), entry('p2', [], true))).toBe(
      '◆ Ana · Coder · active · claude-opus-5-5/max [orphan]',
    );
    expect(nodeLabel(undefined, entry('p9'))).toBe('? p9');
  });

  it('draws guides for deep and wide trees and puts every top at the margin', () => {
    const chart: OrgChart = {
      nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => person(id, null, id.toUpperCase())),
      tree: [entry('a', [entry('b', [entry('c'), entry('d')]), entry('e')]), entry('f')],
    };
    expect(treeLines(chart)).toEqual([
      'A · member',
      '├── B · member',
      '│   ├── C · member',
      '│   └── D · member',
      '└── E · member',
      'F · member',
    ]);
  });

  it('counts people and agents in the heading, and says when nobody is on the chart', () => {
    const chart: OrgChart = {
      nodes: [person('p1', null, 'Olga'), agentNode('p2', 'p1', 'Ana')],
      tree: [entry('p1', [entry('p2')])],
    };
    expect(chartText(ACME, chart)).toBe(
      'Acme (acme): 1 person, 1 agent\nOlga · member\n└── ◆ Ana · Coder · active · claude-opus-5-5/max\n',
    );
    expect(chartText(ACME, { nodes: [], tree: [] })).toBe(
      'Acme (acme): 0 people, 0 agents\nNobody is on the chart yet.\n',
    );
  });
});

describe('the agents as text', () => {
  const chart: OrgChart = { nodes: [person('p1', null, 'Olga')], tree: [entry('p1')] };

  it('names the manager, or says nobody or off the chart', () => {
    const names = principalNames(chart);
    expect(managerLabel(agent({ reportsTo: 'p1' }), names)).toBe('Olga');
    expect(managerLabel(agent({ reportsTo: null }), names)).toBe('-');
    expect(managerLabel(agent({ reportsTo: 'p9' }), names)).toBe('(off the chart)');
  });

  it('aligns columns two spaces apart without trailing spaces', () => {
    expect(
      alignRows([
        ['A', 'BB', 'C'],
        ['DDD', '', ''],
      ]),
    ).toBe('A    BB  C\nDDD\n');
    expect(alignRows([])).toBe('');
  });

  it('says which agents there are none of', () => {
    expect(agentsText(ACME, [], chart)).toBe('No active or paused agents in Acme (acme).\n');
    expect(agentsText(ACME, [], chart, 'all')).toBe('No agents in Acme (acme).\n');
    expect(agentsText(ACME, [], chart, 'archived')).toBe('No archived agents in Acme (acme).\n');
    expect(agentsText(ACME, [agent({ reportsTo: 'p1' })], chart)).toBe(
      'NAME      SLUG      ROLE   STATUS  MODEL            EFFORT  REPORTS TO\n' +
        'SLOP BOX  slop-box  Coder  active  claude-opus-5-5  high    Olga\n',
    );
  });
});

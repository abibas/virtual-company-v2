import { describe, expect, it } from 'vitest';
import {
  addedViolations,
  applyMoves,
  buildTree,
  type Chart,
  type ChartNode,
  descendants,
  directReports,
  moveVerdict,
  nearestPersonUp,
  type OrgTreeNode,
  reparentOnRemoval,
  validateChart,
  validateMove,
} from '../src/org-chart.ts';

// A small chart builder: a person or an agent and whom it reports to.
const node = (kind: ChartNode['kind'], principalId: string, reportsTo: string | null): ChartNode => ({
  principalId,
  kind,
  reportsTo,
});
const person = (id: string, to: string | null = null) => node('person', id, to);
const agent = (id: string, to: string | null) => node('agent', id, to);
const ids = (nodes: readonly { readonly principalId: string }[]) => nodes.map((node) => node.principalId);
const codes = (chart: Chart) => validateChart(chart).map(({ code, principalId }) => `${principalId}:${code}`);

// Two people at the top; agents under agents under a person; listed out of tree order on purpose, so every list
// below shows the chart's order rather than an order of its own.
//   ihor ── pm ── qa, dev
//        ── olga ── coder ── helper ── tester
//                ── max
//        ── reviewer
//   dana ── scout
const company: Chart = [
  person('ihor'),
  agent('pm', 'ihor'),
  person('olga', 'ihor'),
  agent('qa', 'pm'),
  agent('dev', 'pm'),
  person('dana'),
  agent('coder', 'olga'),
  agent('scout', 'dana'),
  person('max', 'olga'),
  agent('helper', 'coder'),
  agent('tester', 'helper'),
  agent('reviewer', 'ihor'),
];

// Broken data a valid chart never holds: an agent whose manager is not on the chart, and two agents in a loop.
const broken: Chart = [...company, agent('stray', 'ghost'), agent('loop1', 'loop2'), agent('loop2', 'loop1')];

describe('validateMove', () => {
  it('allows moves that keep every invariant, a whole subtree included', () => {
    for (const [principal, manager] of [
      ['olga', null], // a person to the top
      ['max', 'dana'], // a person under another person, across the two tops
      ['pm', 'dana'], // an agent and its two reports under another person
      ['coder', 'dev'], // an agent and its chain under an agent under a person
      ['tester', 'reviewer'],
      ['olga', 'ihor'], // the manager it has already
    ] as const) {
      expect(validateMove(company, principal, manager)).toEqual({ ok: true });
    }
  });

  it('refuses a principal or a manager that is not on the chart (unknown_principal)', () => {
    expect(validateMove(company, 'ghost', 'ihor')).toEqual({
      ok: false,
      code: 'unknown_principal',
      message: "This person or agent is not on this company's org chart.",
    });
    expect(validateMove(company, 'max', 'ghost')).toEqual({
      ok: false,
      code: 'unknown_principal',
      message: "The new manager is not on this company's org chart.",
    });
    expect(validateMove(company, 'ghost', null)).toMatchObject({ code: 'unknown_principal' });
  });

  it('refuses reporting to oneself (self), before any other reason', () => {
    expect(validateMove(company, 'olga', 'olga')).toEqual({
      ok: false,
      code: 'self',
      message: 'Nobody can report to themselves.',
    });
    expect(validateMove(company, 'coder', 'coder')).toMatchObject({ code: 'self' });
  });

  it('refuses a manager below the one moved, near or deep (cycle)', () => {
    expect(validateMove(company, 'olga', 'max')).toEqual({
      ok: false,
      code: 'cycle',
      message: 'The new manager is below the one being moved, so this move would make a reporting loop.',
    });
    expect(validateMove(company, 'coder', 'tester')).toMatchObject({ code: 'cycle' });
    // A person under an agent below them: the loop is the first reason.
    expect(validateMove(company, 'ihor', 'tester')).toMatchObject({ code: 'cycle' });
  });

  it('refuses an agent at the top (agent_root)', () => {
    expect(validateMove(company, 'pm', null)).toEqual({
      ok: false,
      code: 'agent_root',
      message: 'An agent must report to someone; only people can be at the top of the chart.',
    });
    expect(validateMove(company, 'tester', null)).toMatchObject({ code: 'agent_root' });
  });

  it('refuses a person under an agent (agent_manages_person)', () => {
    expect(validateMove(company, 'max', 'coder')).toEqual({
      ok: false,
      code: 'agent_manages_person',
      message: 'A person cannot report to an agent; people report only to people.',
    });
    expect(validateMove(company, 'dana', 'pm')).toMatchObject({ code: 'agent_manages_person' });
  });

  it('refuses moving a subtree under a chain that reaches no person (chain_without_person)', () => {
    const refusal = {
      ok: false,
      code: 'chain_without_person',
      message: 'Every agent needs a person above it, and this move would leave an agent without one.',
    };
    expect(validateMove(broken, 'coder', 'stray')).toEqual(refusal);
    expect(validateMove(broken, 'dev', 'loop1')).toEqual(refusal);
    // The whole subtree would be stranded, not only the agent moved.
    const after = applyMoves(broken, [{ principalId: 'coder', reportsTo: 'stray' }]);
    const stranded = codes(after).filter((code) => code.endsWith(':chain_without_person'));
    expect(stranded.map((code) => code.split(':')[0]).join(' ')).toBe(
      'coder helper tester stray loop1 loop2',
    );
  });

  it('judges a move on broken data without hanging, as long as the move itself is sound', () => {
    expect(validateMove(broken, 'max', 'dana')).toEqual({ ok: true });
    expect(validateMove(broken, 'stray', 'olga')).toEqual({ ok: true }); // the move that repairs it
    expect(validateMove(broken, 'loop1', 'ihor')).toEqual({ ok: true });
    expect(validateMove(broken, 'loop1', 'loop2')).toMatchObject({ code: 'cycle' });
  });
});

describe('addedViolations', () => {
  it('lists only the flaws the second chart adds, in its order', () => {
    const before = [{ principalId: 'a', kind: 'agent', reportsTo: null }] as const;
    const after = [...before, { principalId: 'b', kind: 'agent', reportsTo: null }] as const;
    expect(addedViolations(before, after)).toMatchObject([{ code: 'agent_root', principalId: 'b' }]);
    expect(addedViolations(after, before)).toEqual([]);
  });
});

describe('moveVerdict', () => {
  it('allows what validateMove allows when the move adds no flaw, the manager it has already included', () => {
    expect(moveVerdict(company, 'pm', 'dana')).toEqual({ ok: true });
    expect(moveVerdict(company, 'olga', 'ihor')).toEqual({ ok: true });
    expect(moveVerdict(company, 'max', null)).toEqual({ ok: true });
  });

  it("refuses with validateMove's code and sentence first", () => {
    expect(moveVerdict(company, 'olga', 'pm')).toEqual(validateMove(company, 'olga', 'pm'));
    expect(moveVerdict(company, 'pm', null)).toMatchObject({ ok: false, code: 'agent_root' });
    expect(moveVerdict(company, 'ihor', 'tester')).toMatchObject({ ok: false, code: 'cycle' });
  });

  it('still takes moves on a flawed chart that add no flaw, and refuses one that adds a flaw', () => {
    expect(moveVerdict(broken, 'max', 'dana')).toEqual({ ok: true });
    // An agent at the top already, hanging a second agent under it: the second one has no person above it.
    const flawed: Chart = [person('p'), agent('top-bot', null), agent('bot', 'p')];
    expect(moveVerdict(flawed, 'bot', 'top-bot')).toEqual({
      ok: false,
      code: 'chain_without_person',
      message: 'Every agent needs a person above it, and this move would leave an agent without one.',
    });
    // Under an orphan (its manager is off the chart): the orphan's own flaw was there before, so it is not counted.
    const orphaned: Chart = [person('p'), person('lost', 'ghost'), person('q', 'p')];
    expect(moveVerdict(orphaned, 'q', 'lost')).toEqual({ ok: true });
  });
});

describe('nearestPersonUp', () => {
  it('is the person themselves, or the first person above an agent, however deep', () => {
    expect(nearestPersonUp(company, 'olga')).toBe('olga');
    expect(nearestPersonUp(company, 'ihor')).toBe('ihor');
    expect(nearestPersonUp(company, 'pm')).toBe('ihor');
    expect(nearestPersonUp(company, 'qa')).toBe('ihor');
    expect(nearestPersonUp(company, 'tester')).toBe('olga');
    expect(nearestPersonUp(company, 'scout')).toBe('dana');
  });

  it('is null when there is none, so the caller falls back to the company owner', () => {
    expect(nearestPersonUp(company, 'ghost')).toBeNull();
    expect(nearestPersonUp(broken, 'stray')).toBeNull();
    expect(nearestPersonUp(broken, 'loop1')).toBeNull();
    expect(nearestPersonUp([agent('bot', null)], 'bot')).toBeNull();
  });

  it('ends on a loop in the data, and finds a person on it', () => {
    const loop = [person('lead', 'bot'), agent('bot', 'lead'), agent('below', 'bot')];
    expect(nearestPersonUp(loop, 'below')).toBe('lead');
    expect(nearestPersonUp(loop, 'bot')).toBe('lead');
    expect(nearestPersonUp([agent('me', 'me')], 'me')).toBeNull();
  });
});

describe('directReports and descendants', () => {
  it('lists direct reports in chart order', () => {
    expect(ids(directReports(company, 'ihor'))).toEqual(['pm', 'olga', 'reviewer']);
    expect(ids(directReports(company, 'pm'))).toEqual(['qa', 'dev']);
    expect(directReports(company, 'tester')).toEqual([]);
    expect(directReports(company, 'ghost')).toEqual([]);
    expect(directReports(company, 'olga')).toEqual([agent('coder', 'olga'), person('max', 'olga')]);
  });

  it('lists descendants depth-first, each report followed by everyone below it, in chart order', () => {
    expect(ids(descendants(company, 'ihor')).join(' ')).toBe(
      'pm qa dev olga coder helper tester max reviewer',
    );
    expect(ids(descendants(company, 'olga'))).toEqual(['coder', 'helper', 'tester', 'max']);
    expect(descendants(company, 'scout')).toEqual([]);
    expect(descendants(company, 'ghost')).toEqual([]);
  });

  it('ends on loops in the data and never lists the principal itself', () => {
    const loop = [agent('a', 'c'), agent('b', 'a'), agent('c', 'b'), agent('d', 'b'), person('me', 'me')];
    expect(ids(descendants(loop, 'a'))).toEqual(['b', 'c', 'd']);
    expect(ids(descendants(loop, 'c'))).toEqual(['a', 'b', 'd']);
    expect(directReports(loop, 'me')).toEqual([]);
    expect(descendants(loop, 'me')).toEqual([]);
  });

  it('counts a principal listed twice by its first entry', () => {
    const twice = [person('boss'), agent('bot', 'boss'), person('other'), agent('bot', 'other')];
    expect(ids(directReports(twice, 'boss'))).toEqual(['bot']);
    expect(directReports(twice, 'other')).toEqual([]);
  });
});

describe('reparentOnRemoval', () => {
  /** The moves as `principal>manager`, and what validateChart finds after them, without the one leaving. */
  const remove = (chart: Chart, principalId: string, fallback: string | null) => {
    const moves = reparentOnRemoval(chart, principalId, fallback);
    const after = applyMoves(chart, moves, principalId);
    expect(ids(after)).not.toContain(principalId);
    return { moves: moves.map((move) => `${move.principalId}>${move.reportsTo}`), violations: codes(after) };
  };

  it('moves the reports of a middle manager, people and agents, to its own manager', () => {
    expect(reparentOnRemoval(company, 'olga', 'ihor')).toEqual([
      { principalId: 'coder', reportsTo: 'ihor' },
      { principalId: 'max', reportsTo: 'ihor' },
    ]);
    expect(remove(company, 'olga', 'ihor').violations).toEqual([]);
  });

  it('moves the agent reports of an archived agent to its manager, a person or an agent', () => {
    expect(remove(company, 'pm', 'ihor')).toEqual({ moves: ['qa>ihor', 'dev>ihor'], violations: [] });
    expect(remove(company, 'helper', 'ihor')).toEqual({ moves: ['tester>coder'], violations: [] });
  });

  it('puts the people of a root person at the top and its agents under the fallback owner', () => {
    expect(remove(company, 'ihor', 'dana')).toEqual({
      moves: ['pm>dana', 'olga>null', 'reviewer>dana'],
      violations: [],
    });
    // The owner may be one of the reports of the one leaving, who moves to the top.
    expect(remove(company, 'ihor', 'olga')).toEqual({
      moves: ['pm>olga', 'olga>null', 'reviewer>olga'],
      violations: [],
    });
  });

  it('never uses a fallback that is not a person on the chart; validateChart then refuses the result', () => {
    for (const fallback of [null, 'ihor', 'ghost', 'pm']) {
      expect(remove(company, 'ihor', fallback)).toEqual({
        moves: ['pm>null', 'olga>null', 'reviewer>null'],
        violations: [
          'pm:agent_root',
          'qa:chain_without_person',
          'dev:chain_without_person',
          'reviewer:agent_root',
        ],
      });
    }
  });

  it('returns nothing for a leaf or for a principal not on the chart', () => {
    expect(reparentOnRemoval(company, 'tester', 'ihor')).toEqual([]);
    expect(reparentOnRemoval(company, 'ghost', 'ihor')).toEqual([]);
  });

  it('treats a manager not on the chart, or with no person above it, like the top', () => {
    const unknown = [person('owner'), person('lost', 'ghost'), agent('bot', 'lost'), person('kid', 'lost')];
    expect(remove(unknown, 'lost', 'owner')).toEqual({ moves: ['bot>owner', 'kid>null'], violations: [] });
    const stranded = remove([...broken, agent('a1', 'stray'), agent('a2', 'a1')], 'a1', 'ihor');
    expect(stranded.moves).toEqual(['a2>ihor']);
    expect(stranded.violations.filter((code) => code.startsWith('a2:'))).toEqual([]);
  });

  it('ends on loops through the one leaving', () => {
    const loop = [person('r', 'm'), person('m', 'r'), agent('bot', 'r')];
    expect(remove(loop, 'r', 'm')).toEqual({ moves: ['m>null', 'bot>m'], violations: [] });
    const self = [person('me', 'me'), agent('bot', 'me'), person('owner')];
    expect(remove(self, 'me', 'owner')).toEqual({ moves: ['bot>owner'], violations: [] });
  });
});

describe('validateChart', () => {
  it('finds nothing wrong with a valid chart, or an empty one', () => {
    expect(validateChart(company)).toEqual([]);
    expect(validateChart([])).toEqual([]);
  });

  it('reports every broken invariant with its code, on the principal that breaks it, in chart order', () => {
    const chart = [
      person('boss'),
      agent('rootbot', null),
      person('intern', 'rootbot'),
      agent('subbot', 'rootbot'),
      person('far', 'ghost'),
      agent('lost', 'ghost'),
      person('narcissus', 'narcissus'),
      agent('mirror', 'mirror'),
      agent('loop1', 'loop2'),
      agent('loop2', 'loop1'),
      person('lead', 'bot'),
      agent('bot', 'lead'),
      agent('boss', 'rootbot'),
    ];
    expect(codes(chart)).toEqual([
      'rootbot:agent_root',
      'intern:agent_manages_person',
      'subbot:chain_without_person',
      'far:unknown_manager',
      'lost:unknown_manager',
      'lost:chain_without_person',
      'narcissus:self',
      'mirror:self',
      'mirror:chain_without_person',
      'loop1:cycle',
      'loop1:chain_without_person',
      'loop2:cycle',
      'loop2:chain_without_person',
      'lead:cycle',
      'lead:agent_manages_person',
      'bot:cycle',
      'boss:duplicate_principal',
    ]);
  });

  it('gives each violation a sentence a UI can show', () => {
    const chart = [
      agent('bot', null),
      person('p', 'bot'),
      person('p'),
      person('q', 'nobody'),
      person('s', 's'),
    ];
    const violations = validateChart([...chart, agent('x', 'y'), agent('y', 'x')]);
    expect(violations[0]).toEqual({
      code: 'agent_root',
      principalId: 'bot',
      message: 'This agent reports to nobody; only people can be at the top of the chart.',
    });
    expect(Object.fromEntries(violations.map(({ code, message }) => [code, message]))).toEqual({
      agent_root: 'This agent reports to nobody; only people can be at the top of the chart.',
      agent_manages_person: 'This person reports to an agent; people report only to people.',
      duplicate_principal: 'This person or agent is on the chart more than once.',
      unknown_manager: 'This person or agent reports to someone who is not on the chart.',
      self: 'This person or agent reports to themselves.',
      cycle: 'This person or agent is in a reporting loop.',
      chain_without_person: 'This agent has no person above it.',
    });
  });
});

describe('buildTree', () => {
  /** A tree as nested ids, `*` marking an orphan. */
  const shape = (nodes: readonly OrgTreeNode[]): unknown[] =>
    nodes.map((node) => {
      const name = `${node.principalId}${node.orphan ? '*' : ''}`;
      return node.children.length === 0 ? name : { [name]: shape(node.children) };
    });
  const count = (nodes: readonly OrgTreeNode[]): number =>
    nodes.reduce((total, node) => total + 1 + count(node.children), 0);

  it('nests the chart under its tops, each level in chart order', () => {
    expect(shape(buildTree(company))).toEqual([
      { ihor: [{ pm: ['qa', 'dev'] }, { olga: [{ coder: [{ helper: ['tester'] }] }, 'max'] }, 'reviewer'] },
      { dana: ['scout'] },
    ]);
    const [ihor] = buildTree(company);
    expect(ihor).toMatchObject({ principalId: 'ihor', kind: 'person', orphan: false });
    expect(ihor?.children[0]).toMatchObject({ principalId: 'pm', kind: 'agent', orphan: false });
    expect(buildTree([])).toEqual([]);
  });

  it('places a report listed before its manager under that manager', () => {
    const reversed = [...company].reverse();
    expect(shape(buildTree(reversed))).toEqual([
      { dana: ['scout'] },
      { ihor: ['reviewer', { olga: ['max', { coder: [{ helper: ['tester'] }] }] }, { pm: ['dev', 'qa'] }] },
    ]);
  });

  it('lists principals whose manager is not on the chart, and the first of each loop, as orphan tops', () => {
    const chart = [
      person('top'),
      agent('under-loop', 'loop2'),
      agent('kid', 'lost'),
      agent('lost', 'ghost'),
      agent('loop1', 'loop2'),
      agent('loop2', 'loop1'),
      person('me', 'me'),
      person('second'),
      agent('bot', 'top'),
    ];
    expect(shape(buildTree(chart))).toEqual([
      { top: ['bot'] },
      { 'lost*': ['kid'] },
      { 'loop1*': [{ loop2: ['under-loop'] }] },
      'me*',
      'second',
    ]);
    expect(count(buildTree(chart))).toBe(chart.length);
    expect(count(buildTree(broken))).toBe(broken.length);
  });
});

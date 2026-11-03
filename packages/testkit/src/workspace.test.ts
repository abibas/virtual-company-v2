import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The testkit depends on the server (to build test apps) and the server's tests use the testkit, a
 * dev-only cycle that pnpm warns about on every install; pnpm-workspace.yaml therefore sets
 * `ignoreWorkspaceCycles`. This guard keeps that switch from hiding a real cycle.
 */
const root = resolve(import.meta.dirname, '../../..');

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function manifests(): Manifest[] {
  const found: Manifest[] = [];
  for (const group of ['apps', 'packages']) {
    for (const dir of readdirSync(join(root, group))) {
      const path = join(root, group, dir, 'package.json');
      if (existsSync(path)) found.push(JSON.parse(readFileSync(path, 'utf8')) as Manifest);
    }
  }
  return found;
}

/** A dependency cycle among workspace packages (as names), or null. */
function findCycle(graph: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (node: string): string[] | null => {
    if (state.get(node) === 'done') return null;
    if (state.get(node) === 'open') return [...path.slice(path.indexOf(node)), node];
    state.set(node, 'open');
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

function graphOf(all: Manifest[], withDev: boolean, without?: string): Map<string, string[]> {
  const names = new Set(all.map((m) => m.name).filter((name) => name !== without));
  const graph = new Map<string, string[]>();
  for (const m of all) {
    if (!names.has(m.name)) continue;
    const deps = { ...m.dependencies, ...(withDev ? m.devDependencies : {}) };
    graph.set(
      m.name,
      Object.keys(deps).filter((dep) => names.has(dep)),
    );
  }
  return graph;
}

describe('workspace dependency graph', () => {
  const all = manifests();

  it('finds the workspace packages', () => {
    expect(all.map((m) => m.name)).toEqual(
      expect.arrayContaining(['@mwc/server', '@mwc/db', '@mwc/testkit']),
    );
  });

  it('has no cycle through production dependencies', () => {
    expect(findCycle(graphOf(all, false))).toBeNull();
  });

  it('has no cycle that does not pass through @mwc/testkit, even with devDependencies', () => {
    expect(findCycle(graphOf(all, true, '@mwc/testkit'))).toBeNull();
    // The guard itself works: with the testkit the dev-only cycle is there.
    expect(findCycle(graphOf(all, true))).toEqual(expect.arrayContaining(['@mwc/testkit', '@mwc/server']));
  });

  it('never ships the testkit: it is only ever a devDependency', () => {
    const shipping = all.filter((m) => m.dependencies?.['@mwc/testkit']).map((m) => m.name);
    expect(shipping).toEqual([]);
  });
});

import { ABSOLUTE_PATH_PATTERN, PLACEMENT_PATH } from '@mwc/shared/machines';
import { useState } from 'react';
import type {
  AgentPlacement,
  AgentPlacementSummary,
  PlacementChange,
  PlacementMode,
} from '../../api/types.ts';
import type { SegmentOption } from '../../components/forms/Segmented.tsx';

/** What "Where it runs" holds: a machine (empty for nowhere), the mode and the home folder. */
export interface PlacementValues {
  readonly machineId: string;
  readonly mode: PlacementMode;
  readonly home: string;
}

export interface PlacementDraft {
  readonly values: PlacementValues;
  set<K extends keyof PlacementValues>(key: K, value: PlacementValues[K]): void;
  /** Nowhere, or a home folder the API takes (absolute, at most 500 characters). */
  readonly valid: boolean;
  /** The placement as saved: undefined while it loads, null for nowhere. */
  readonly saved: AgentPlacement | undefined;
  reset(): void;
}

export const MODE_OPTIONS: readonly SegmentOption<PlacementMode>[] = [
  { value: 'host', label: 'On the machine, in a folder' },
  { value: 'container', label: 'In a fresh locked-down container per run' },
];

const MODE_WORDS: Readonly<Record<PlacementMode, string>> = {
  host: 'in a folder',
  container: 'in a container',
};

/** "This Mac · in a folder", or "Nowhere yet". */
export function placementLine(placement: AgentPlacementSummary | null): string {
  return placement ? `${placement.machineName} · ${MODE_WORDS[placement.mode]}` : 'Nowhere yet';
}

const startOf = (saved: AgentPlacement | undefined): PlacementValues => ({
  machineId: saved?.machineId ?? '',
  mode: saved?.mode ?? 'host',
  home: saved?.home ?? '',
});

/** Which saved placement the values started from: loading, nowhere, or one version of one. */
const versionOf = (saved: AgentPlacement | undefined) =>
  saved === undefined ? 'loading' : saved === null ? 'none' : `${saved.id}:${saved.updatedAt}`;

const isFolder = (path: string) =>
  path.trim().length <= PLACEMENT_PATH.max && ABSOLUTE_PATH_PATTERN.test(path.trim());

/** The draft of where an agent runs, started again whenever the saved placement loads or changes. */
export function usePlacementDraft(saved: AgentPlacement | undefined): PlacementDraft {
  const version = versionOf(saved);
  const [state, setState] = useState(() => ({ version, values: startOf(saved) }));
  if (state.version !== version) setState({ version, values: startOf(saved) });
  const values = state.version === version ? state.values : startOf(saved);
  return {
    values,
    set: (key, value) => setState((current) => ({ ...current, values: { ...current.values, [key]: value } })),
    valid: values.machineId === '' || isFolder(values.home),
    saved,
    reset: () => setState({ version, values: startOf(saved) }),
  };
}

/** What saving the draft does: nothing, `PUT` the placement, or `DELETE` it. */
export type PlacementStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'put'; readonly change: PlacementChange }
  | { readonly kind: 'delete' };

/** The step from the saved placement to the draft; the folders the form does not show are kept as they are. */
export function placementStep(draft: PlacementDraft): PlacementStep {
  const { values, saved } = draft;
  if (saved === undefined) return { kind: 'none' };
  if (values.machineId === '') return saved === null ? { kind: 'none' } : { kind: 'delete' };
  const home = values.home.trim();
  const same =
    saved !== null &&
    saved.machineId === values.machineId &&
    saved.mode === values.mode &&
    saved.home === home;
  if (same) return { kind: 'none' };
  return {
    kind: 'put',
    change: {
      machineId: values.machineId,
      mode: values.mode,
      home,
      configDir: saved?.configDir ?? null,
      worktreeRoot: saved?.worktreeRoot ?? null,
    },
  };
}

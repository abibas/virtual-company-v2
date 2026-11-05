import type { Effort, Harness } from './enums.ts';

/**
 * The org chart's contract (docs/architecture.md, section 6): the limits of an agent and of a place on the chart,
 * which the API's zod schemas and the CHECKs of `agents` and `org_positions` (`@mwc/db`) both read, so they accept
 * the same values; the defaults of a new agent; and the face a new agent is drawn with.
 */

/** An agent's name ("SLOP BOX"), after trimming: 1 to 80 characters (`agents_name_check`). */
export const AGENT_NAME = { min: 1, max: 80 } as const;

/** An agent's job on the chart ("Coder"), after trimming: 1 to 80 characters (`agents_role_title_check`). */
export const AGENT_ROLE_TITLE = { min: 1, max: 80 } as const;

/** A title on the chart ("CTO"), for a person or an agent: at most 80 characters (`org_positions_title_check`). */
export const POSITION_TITLE_MAX = 80;

/** How many runs of one agent may go at once: 1 to 8 (`agents_max_concurrent_runs_check`). */
export const AGENT_MAX_CONCURRENT_RUNS = { min: 1, max: 8 } as const;

/** The web's drawn faces (`AgentFace`, 7 colours × 6 features): 0 to 41 (`agents_face_check`). */
export const AGENT_FACE = { min: 0, max: 41 } as const;

/** The longest model id the API takes (no CHECK: the harness decides which ids exist). */
export const AGENT_MODEL_MAX = 100;

/** The longest standing instructions the API takes, in characters (no CHECK). */
export const AGENT_INSTRUCTIONS_MAX = 100_000;

/** What a new agent gets for the fields it is created without (its face comes from its slug, `agentFace`). */
export const AGENT_DEFAULTS: {
  readonly model: string;
  readonly effort: Effort;
  readonly harness: Harness;
  readonly instructions: string;
  readonly maxConcurrentRuns: number;
} = {
  model: 'claude-opus-5-5',
  effort: 'high',
  harness: 'claude_code',
  instructions: '',
  maxConcurrentRuns: 1,
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * The face of a new agent created without one: a stable hash of its slug (32-bit FNV-1a over its characters) modulo
 * the 42 faces, so the same slug always gets the same face, on the server and in the web's form.
 */
export function agentFace(slug: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < slug.length; i++) {
    hash = Math.imul(hash ^ slug.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return hash % (AGENT_FACE.max - AGENT_FACE.min + 1);
}

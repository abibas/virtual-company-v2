import type { AgentRef, AttentionItem } from '../../components/feed/kinds.ts';

/** The gallery's "now", so the day groups always read Today, Yesterday and a dated day. */
export const SAMPLE_NOW = new Date(2026, 10, 4, 10, 30);

const at = (daysAgo: number, time: string) => {
  const date = new Date(SAMPLE_NOW);
  date.setDate(date.getDate() - daysAgo);
  const [hours, minutes] = time.split(':').map(Number);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date.toISOString();
};

export const SAMPLE_AGENTS: readonly AgentRef[] = [
  { id: 'scout', name: 'Scout', role: 'Researcher', face: 0 },
  { id: 'mason', name: 'Mason', role: 'Coder', face: 1 },
  { id: 'juno', name: 'Juno', role: 'Reviewer', face: 2 },
  { id: 'pip', name: 'Pip', role: 'QA', face: 3 },
  { id: 'vega', name: 'Vega', role: 'Planner', face: 4 },
];

const [scout, mason, juno, pip, vega] = SAMPLE_AGENTS;

/** Every kind, across Today, Yesterday and an earlier day. */
export const SAMPLE_ATTENTION: readonly AttentionItem[] = [
  {
    id: '1',
    kind: 'needs_input',
    title: 'Which database for the prototype?',
    subtitle: 'Scout, data model for the pilot',
    at: at(0, '09:40'),
    ...(scout ? { agent: scout } : {}),
  },
  {
    id: '2',
    kind: 'review',
    title: 'Sign-in flow is ready for a look',
    subtitle: 'Mason, pull request #214',
    at: at(0, '08:15'),
    ...(mason ? { agent: mason } : {}),
  },
  {
    id: '3',
    kind: 'blocked',
    title: 'Needs the staging credentials',
    subtitle: 'Pip, smoke test of the release',
    at: at(0, '07:05'),
    ...(pip ? { agent: pip } : {}),
  },
  {
    id: '4',
    kind: 'failed',
    title: 'Build broke on the migration step',
    subtitle: 'Mason, release 1.4',
    at: at(1, '21:10'),
    ...(mason ? { agent: mason } : {}),
  },
  {
    id: '5',
    kind: 'done',
    title: 'Weekly numbers sent to the team',
    subtitle: 'Juno',
    at: at(1, '18:47'),
    ...(juno ? { agent: juno } : {}),
  },
  {
    id: '6',
    kind: 'pending',
    title: 'Plan the onboarding checklist',
    subtitle: 'Vega, queued behind two tasks',
    at: at(1, '16:20'),
    ...(vega ? { agent: vega } : {}),
  },
  {
    id: '7',
    kind: 'done',
    title: 'Renamed the staging buckets',
    subtitle: 'Scout',
    at: at(3, '15:20'),
    ...(scout ? { agent: scout } : {}),
  },
  {
    id: '8',
    kind: 'review',
    title: 'Pricing page copy, second pass',
    subtitle: 'Juno, for the launch',
    at: at(3, '11:35'),
    ...(juno ? { agent: juno } : {}),
  },
];

export interface SamplePerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly joinedAt: string;
}

export const SAMPLE_PEOPLE: readonly SamplePerson[] = [
  {
    id: 'p1',
    name: 'Ihor Herasko',
    email: 'ihor@example.com',
    role: 'owner',
    status: 'active',
    joinedAt: at(40, '10:00'),
  },
  {
    id: 'p2',
    name: 'Olena Marsh',
    email: 'olena@example.com',
    role: 'admin',
    status: 'active',
    joinedAt: at(21, '14:00'),
  },
  {
    id: 'p3',
    name: 'Theo Laurent',
    email: 'theo@example.com',
    role: 'member',
    status: 'invited',
    joinedAt: at(2, '09:00'),
  },
  {
    id: 'p4',
    name: 'Nadia Qureshi',
    email: 'nadia@example.com',
    role: 'viewer',
    status: 'suspended',
    joinedAt: at(60, '12:00'),
  },
];

/** A made-up logo for the gallery: a bolt on the teal gradient, as an SVG data URL (any `src` can take it). */
export const SAMPLE_LOGO_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2bd1b9"/>' +
    '<stop offset="1" stop-color="#0b8c7e"/></linearGradient></defs>' +
    '<rect width="256" height="256" rx="56" fill="url(#g)"/>' +
    '<path d="M150 40 90 140h40l-24 76 64-104h-40z" fill="#fff"/></svg>',
)}`;

/** The same logo as a file, for the picker and the draft (an SVG the picker rasterises to PNG). */
export async function sampleLogoFile(): Promise<File> {
  const blob = await (await fetch(SAMPLE_LOGO_SRC)).blob();
  return new File([blob], 'sample-logo.svg', { type: 'image/svg+xml' });
}

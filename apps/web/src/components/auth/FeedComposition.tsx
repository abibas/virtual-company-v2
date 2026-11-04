import { CircleCheck } from 'lucide-react';
import { List } from '../data/List.tsx';
import { AgentFace } from '../feed/AgentFace.tsx';
import { AttentionRow } from '../feed/AttentionRow.tsx';
import type { AttentionItem } from '../feed/kinds.ts';
import { AvatarStack } from '../ui/Avatar.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';

/** Three moments of a day with agents, drawn on the brand panel (an illustration, not anyone's data). */
const MOMENTS: readonly AttentionItem[] = [
  {
    id: 'ask',
    kind: 'needs_input',
    title: 'Which database for the prototype?',
    subtitle: 'Scout, on the data model',
    at: '2026-11-04T09:40:00',
  },
  {
    id: 'review',
    kind: 'review',
    title: 'Sign-in flow is ready for a look',
    subtitle: 'Mason, pull request #214',
    at: '2026-11-04T08:15:00',
  },
  {
    id: 'done',
    kind: 'done',
    title: 'Weekly numbers sent to the team',
    subtitle: 'Juno',
    at: '2026-11-03T18:05:00',
  },
];

const FACES = [
  { name: 'Scout', fallback: <AgentFace variant={0} /> },
  { name: 'Mason', fallback: <AgentFace variant={1} /> },
  { name: 'Juno', fallback: <AgentFace variant={2} /> },
  { name: 'Pip', fallback: <AgentFace variant={3} /> },
];

/** The composition on the brand panel: a feed card, with a small card of faces floating over its corner. */
export function FeedComposition() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <Card padding="sm" className="pt-3">
        <p className="px-2 pb-1 text-xs font-semibold text-dim">Today</p>
        <List>
          {MOMENTS.map((item) => (
            <AttentionRow key={item.id} item={item} />
          ))}
        </List>
      </Card>
      <div className="absolute -top-10 -right-3 w-52 rotate-[2.5deg] sm:-right-8">
        <Card padding="sm" className="shadow-raised">
          <p className="text-xs font-semibold text-dim">Agents at work</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <AvatarStack people={FACES} size="sm" />
            <Badge tone="done" icon={CircleCheck} size="sm">
              4 running
            </Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}

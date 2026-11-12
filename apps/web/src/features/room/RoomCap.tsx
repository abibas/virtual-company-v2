import { ROOM } from '@mwc/shared/flows';
import { MessagesSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { roomCalls, useRoom } from '../../api/room.ts';
import { useCompany } from '../../app/company.ts';
import { Input } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { within } from '../flows/wakes/words.ts';

/**
 * The Flow tab's team room cap (docs/processes.md "The team room"), next to the Lead's wake-ups, for those who lead the
 * team: the answers people's messages may ask of its agents in an hour (each agent asked is one), with the answers asked
 * in the last hour, and Save.
 */
export function RoomCapSection({
  maxPerHour,
  askedLastHour,
  onSave,
}: {
  readonly maxPerHour: number;
  readonly askedLastHour: number;
  readonly onSave: (maxPerHour: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(maxPerHour);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = () => {
    setBusy(true);
    setError(undefined);
    onSave(draft)
      .catch((failure: unknown) => setError(friendlyMessage(failure)))
      .finally(() => setBusy(false));
  };
  return (
    <Card padding="sm" as="section" aria-label="Team chat" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <MessagesSquare size={16} aria-hidden="true" className="text-blue" />
        <h2 className="text-sm font-bold text-ink">Team chat</h2>
      </header>
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
        At most
        <span className="w-16 shrink-0">
          <Input
            aria-label="Answers an hour"
            type="number"
            size="sm"
            min={ROOM.maxPerHour.min}
            max={ROOM.maxPerHour.max}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(within(event.target.value, ROOM.maxPerHour))}
          />
        </span>
        answers an hour
        <span className="text-xs font-normal text-dim">{askedLastHour} in the last hour</span>
      </span>
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      {draft !== maxPerHour && (
        <div className="flex gap-2">
          <Button size="sm" tone="primary" busy={busy} onClick={save}>
            Save
          </Button>
          <Button size="sm" tone="quiet" disabled={busy} onClick={() => setDraft(maxPerHour)}>
            Discard
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The cap, live: read with the room, saved with a PUT, then read again. */
export function LiveRoomCap({ flowId }: { readonly flowId: string }) {
  const { companyId } = useCompany().membership;
  const api = useApi();
  const calls = useMemo(() => roomCalls(api, companyId), [api, companyId]);
  const room = useRoom(companyId, flowId);
  if (room.data === undefined) return null;
  const { maxPerHour, askedLastHour } = room.data.cap;
  return (
    <RoomCapSection
      key={maxPerHour}
      maxPerHour={maxPerHour}
      askedLastHour={askedLastHour}
      onSave={async (next) => {
        await calls.putCap(flowId, next);
        room.reload();
      }}
    />
  );
}

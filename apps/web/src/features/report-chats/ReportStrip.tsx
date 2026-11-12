import { Tooltip } from '../../components/ui/Tooltip.tsx';
import { ReportFace } from './ReportFace.tsx';
import type { RailReport } from './standing.ts';

/** At most this many faces in the strip; the rest wait behind "+N". */
export const STRIP_FACES = 6;

/**
 * The collapsed rail's direct reports (under the inbox and the bell): their faces with their dots, the Leads first, at
 * most six; "+N" for the rest opens the Chats view, whose header lists them all. A click opens that agent's chat.
 */
export function ReportStrip({
  reports,
  onPick,
  onMore,
}: {
  readonly reports: readonly RailReport[];
  readonly onPick: (agentId: string) => void;
  readonly onMore: () => void;
}) {
  if (reports.length === 0) return null;
  const shown = reports.length > STRIP_FACES ? reports.slice(0, STRIP_FACES - 1) : reports;
  const rest = reports.length - shown.length;
  const waiting = reports.slice(shown.length).some((r) => r.dot === 'question' || r.dot === 'unseen');
  return (
    <>
      <span aria-hidden="true" className="h-px w-6 bg-line" />
      <ul aria-label="Chats with your direct reports" className="flex flex-col items-center gap-2">
        {shown.map((r) => (
          <li key={r.report.agent.id}>
            <ReportFace report={r} tooltip="left" onPick={() => onPick(r.report.agent.id)} />
          </li>
        ))}
        {rest > 0 && (
          <li>
            <Tooltip label={`${rest} more direct reports`} side="left">
              <button
                type="button"
                aria-label={`${rest} more direct reports`}
                onClick={onMore}
                className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-surface-3 text-2xs font-bold text-ink-2 tabular hover:text-ink"
              >
                +{rest}
                {waiting && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-blue ring-2 ring-surface"
                  />
                )}
              </button>
            </Tooltip>
          </li>
        )}
      </ul>
    </>
  );
}

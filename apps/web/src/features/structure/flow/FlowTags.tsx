import { cx } from '../../../components/cx.ts';
import { KIND } from '../../flows/words.ts';
import type { FlowRole } from './flow-focus.ts';

interface RoleLook {
  readonly title: string;
  /** The chip's fill and text. */
  readonly chip: string;
  /** The card's ring. */
  readonly ring: string;
}

/** The Lead in ink (light on dark, dark on light), each step kind in its own colour (docs/processes.md). */
const LOOK = (kind: FlowRole['kind']): RoleLook =>
  kind === 'lead'
    ? { title: 'Lead', chip: 'bg-ink text-canvas', ring: 'ring-ink' }
    : { title: KIND[kind].label, chip: cx(KIND[kind].soft, KIND[kind].text), ring: KIND[kind].ring };

/** The ring of a highlighted card: its first role's colour. */
export const ringOf = (roles: readonly FlowRole[]): string => LOOK(roles[0]?.kind ?? 'lead').ring;

/** The chips over a highlighted card's top edge: what its member does in the flow, one per role. */
export function FlowTags({ roles }: { readonly roles: readonly FlowRole[] }) {
  return (
    <>
      {roles.map((role) => {
        const look = LOOK(role.kind);
        return (
          <span
            key={role.kind}
            title={role.kind === 'lead' ? look.title : `${look.title}: ${role.label}`}
            className="min-w-0 shrink rounded-full bg-surface shadow-card"
          >
            <span
              className={cx('block h-5 truncate rounded-full px-2 text-2xs leading-5 font-bold', look.chip)}
            >
              {role.label}
            </span>
          </span>
        );
      })}
    </>
  );
}

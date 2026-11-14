import { Check } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../../../components/cx.ts';
import { Avatar } from '../../../components/ui/Avatar.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import type { MemberChoice } from './people-model.ts';

/**
 * A list of the company's members to pick from (2026-11-14): New chat's With and the People sheet's Add person. Each
 * row toggles; the button acts on those picked, with their count.
 */
export function MemberPicker({
  choices,
  action,
  busy,
  onPick,
}: {
  readonly choices: readonly MemberChoice[];
  /** The button's words ("Start chat", "Add"). */
  readonly action: string;
  readonly busy: boolean;
  readonly onPick: (principalIds: readonly string[]) => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (choices.length === 0) return <p className="text-sm text-dim">Everyone who can be here is here.</p>;
  return (
    <div className="grid gap-3">
      <ul className="grid gap-0.5">
        {choices.map((choice) => {
          const on = picked.has(choice.principalId);
          return (
            <li key={choice.principalId}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(choice.principalId)}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2',
                  on && 'bg-blue-soft hover:bg-blue-soft',
                )}
              >
                <Avatar name={choice.name} src={choice.imageUrl} size="xs" />
                <span className="min-w-0 flex-1 truncate text-ink">{choice.name}</span>
                {on && (
                  <Check size={15} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-blue" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        tone="primary"
        size="sm"
        busy={busy}
        disabled={picked.size === 0}
        onClick={() => onPick([...picked])}
      >
        {picked.size === 0 ? action : `${action} (${picked.size})`}
      </Button>
    </div>
  );
}

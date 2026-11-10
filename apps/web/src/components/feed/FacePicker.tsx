import { type KeyboardEvent, useRef } from 'react';
import { cx } from '../cx.ts';
import type { AvatarSize } from '../ui/Avatar.tsx';
import { Tooltip } from '../ui/Tooltip.tsx';
import { AgentIcon } from './AgentIcon.tsx';
import type { AgentRef } from './kinds.ts';

/** One face of the picker: a radio in the ARIA sense, named in a tooltip. */
function FaceButton({
  agent,
  selected,
  focusable,
  disabled,
  size,
  onPick,
  onKey,
  buttonRef,
}: {
  readonly agent: AgentRef;
  readonly selected: boolean;
  readonly focusable: boolean;
  readonly disabled: boolean;
  readonly size: AvatarSize;
  readonly onPick: () => void;
  readonly onKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly buttonRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <Tooltip label={agent.role ? `${agent.name}, ${agent.role}` : agent.name}>
      {/* biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, so each choice is a face. */}
      <button
        ref={buttonRef}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={agent.name}
        aria-disabled={disabled || undefined}
        tabIndex={focusable ? 0 : -1}
        onClick={disabled ? undefined : onPick}
        onKeyDown={disabled ? undefined : onKey}
        className={cx(
          'rounded-full transition-transform duration-150',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-105',
        )}
      >
        <AgentIcon
          agent={agent}
          previewSrc={agent.imageUrl}
          size={size}
          muted={disabled}
          selected={selected && !disabled}
        />
      </button>
    </Tooltip>
  );
}

/** Pick an agent by its face: a row of faces, one selected (arrow keys move it), each named in a tooltip. */
export function FacePicker({
  agents,
  value,
  onChange,
  label = 'Agent',
  size = 'md',
  disabled = false,
  className,
}: {
  readonly agents: readonly AgentRef[];
  readonly value: string | undefined;
  readonly onChange: (id: string) => void;
  readonly label?: string;
  readonly size?: AvatarSize;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + agents.length) % agents.length;
    const agent = agents[next];
    if (!agent) return;
    onChange(agent.id);
    buttons.current[next]?.focus();
  };
  const selectedIndex = Math.max(
    0,
    agents.findIndex((agent) => agent.id === value),
  );
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex flex-wrap items-center gap-2', className)}>
      {agents.map((agent, index) => (
        <FaceButton
          key={agent.id}
          agent={agent}
          selected={agent.id === value}
          focusable={index === selectedIndex}
          disabled={disabled}
          size={size}
          onPick={() => onChange(agent.id)}
          onKey={(event) => move(event, index)}
          buttonRef={(element) => {
            buttons.current[index] = element;
          }}
        />
      ))}
    </div>
  );
}

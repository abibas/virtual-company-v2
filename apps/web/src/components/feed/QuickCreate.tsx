import { ArrowUp } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { cx } from '../cx.ts';
import { IconButton } from '../ui/IconButton.tsx';
import { FacePicker } from './FacePicker.tsx';
import type { AgentRef } from './kinds.ts';

/** The task's words and the send button. */
function TaskInput({
  id,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        The task
      </label>
      <input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-full bg-surface px-4 text-sm text-ink ring-1 ring-line ring-inset outline-none placeholder:text-faint focus:ring-blue disabled:cursor-not-allowed disabled:opacity-60"
      />
      <IconButton
        type="submit"
        label="Create the task"
        icon={ArrowUp}
        tone="primary"
        round
        disabled={disabled || value.trim() === ''}
      />
    </div>
  );
}

/**
 * The dock at the bottom of the right rail: pick an agent by its face, say what to do, send. Until agents exist
 * (S2) it shows the drawn faces and a note, and takes nothing.
 */
export function QuickCreate({
  agents,
  onCreate,
  disabledNote,
  className,
}: {
  readonly agents: readonly AgentRef[];
  /** Makes the task; absent, the dock is disabled with `disabledNote`. */
  readonly onCreate?: (agentId: string, text: string) => void;
  readonly disabledNote?: string | undefined;
  readonly className?: string;
}) {
  const id = useId();
  const [agentId, setAgentId] = useState<string | undefined>(agents[0]?.id);
  const [text, setText] = useState('');
  const disabled = onCreate === undefined || agents.length === 0;
  const agent = agents.find((candidate) => candidate.id === agentId) ?? agents[0];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!onCreate || !agent || text.trim() === '') return;
    onCreate(agent.id, text.trim());
    setText('');
  };
  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${id}-title`}
      className={cx('rounded-xl bg-surface-2 p-3.5', className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${id}-title`} className="text-sm font-bold text-ink">
          Quick create task
        </h3>
        {disabled && disabledNote && <p className="text-xs text-dim">{disabledNote}</p>}
      </div>
      <FacePicker
        agents={agents}
        value={agent?.id}
        onChange={setAgentId}
        disabled={disabled}
        className="mt-3"
      />
      <TaskInput
        id={`${id}-text`}
        value={text}
        disabled={disabled}
        placeholder={agent && !disabled ? `What should ${agent.name} do?` : 'Describe a task'}
        onChange={setText}
      />
    </form>
  );
}

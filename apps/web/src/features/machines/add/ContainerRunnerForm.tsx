import {
  CONTAINER_RUNNER,
  type ContainerRunnerSettings,
  DEFAULT_CONTAINER_RUNNER,
  ContainerRunnerSettings as Settings,
} from '@mwc/shared/container-runner';
import { useState } from 'react';
import { TextField } from '../../../components/forms/Field.tsx';

/**
 * The Docker container's form on the add sheet: its name, CPUs, memory and runs at once, chosen before its token, with
 * one line of guidance. The values go into the compose command (`MWC_RUNNER_*`), which caps the container with them.
 */

/** The form's fields as typed. */
export interface ContainerForm {
  readonly name: string;
  readonly cpus: string;
  readonly memoryGb: string;
  readonly slots: string;
}

const DEFAULT_FORM: ContainerForm = {
  name: DEFAULT_CONTAINER_RUNNER.name,
  cpus: String(DEFAULT_CONTAINER_RUNNER.cpus),
  memoryGb: String(DEFAULT_CONTAINER_RUNNER.memoryGb),
  slots: String(DEFAULT_CONTAINER_RUNNER.slots),
};

type Errors = Partial<Record<keyof ContainerForm, string>>;

const { cpus, memoryGb, slots } = CONTAINER_RUNNER;
const MESSAGES: Record<keyof ContainerForm, string> = {
  name: 'A name of 1 to 80 characters',
  cpus: `From ${cpus.min} to ${cpus.max}`,
  memoryGb: `A whole number from ${memoryGb.min} to ${memoryGb.max}`,
  slots: `A whole number from ${slots.min} to ${slots.max}`,
};

/** The settings when every field is right, else a message per wrong field. */
export function parseContainerForm(form: ContainerForm): {
  settings?: ContainerRunnerSettings;
  errors: Errors;
} {
  const num = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));
  const values = {
    name: form.name,
    cpus: num(form.cpus),
    memoryGb: num(form.memoryGb),
    slots: num(form.slots),
  };
  const parsed = Settings.safeParse(values);
  if (parsed.success) return { settings: parsed.data, errors: {} };
  const errors: Errors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof ContainerForm;
    errors[field] = MESSAGES[field];
  }
  return { errors };
}

/** The form's state, its settings when valid, and its errors. */
export function useContainerForm() {
  const [form, setForm] = useState<ContainerForm>(DEFAULT_FORM);
  const { settings, errors } = parseContainerForm(form);
  return {
    form,
    settings,
    errors,
    change: (patch: Partial<ContainerForm>) => setForm((current) => ({ ...current, ...patch })),
  };
}

export function ContainerRunnerForm({
  form,
  errors,
  onChange,
}: {
  readonly form: ContainerForm;
  readonly errors: Errors;
  readonly onChange: (patch: Partial<ContainerForm>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Name"
        value={form.name}
        maxLength={80}
        error={errors.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <div className="grid grid-cols-3 gap-3">
        <TextField
          label="CPUs"
          type="number"
          inputMode="decimal"
          min={cpus.min}
          max={cpus.max}
          step={0.5}
          value={form.cpus}
          error={errors.cpus}
          onChange={(e) => onChange({ cpus: e.target.value })}
        />
        <TextField
          label="Memory (GB)"
          type="number"
          inputMode="numeric"
          min={memoryGb.min}
          max={memoryGb.max}
          step={1}
          value={form.memoryGb}
          error={errors.memoryGb}
          onChange={(e) => onChange({ memoryGb: e.target.value })}
        />
        <TextField
          label="Runs at once"
          type="number"
          inputMode="numeric"
          min={slots.min}
          max={slots.max}
          step={1}
          value={form.slots}
          error={errors.slots}
          onChange={(e) => onChange({ slots: e.target.value })}
        />
      </div>
      <p className="text-xs text-dim">
        Leave room for Docker's other containers: the Docker Desktop VM's own limit caps these. A Claude Code
        run needs about 1 CPU and 2 GB.
      </p>
    </div>
  );
}

import type { ChartNode, OrgTreeNode } from '../../api/types.ts';
import { Select, type SelectProps } from '../forms/Input.tsx';
import { managerOptions, type Subject } from './chart.ts';

export interface PrincipalSelectProps extends Omit<SelectProps, 'options' | 'value' | 'onChange'> {
  readonly nodes: readonly ChartNode[];
  readonly tree: readonly OrgTreeNode[];
  /** Who is being placed: its own branch is off limits, and a person may not go under an agent. */
  readonly subject: Subject;
  /** The manager's principal id; `TOP` (empty) for the top of the chart. */
  readonly value: string;
  readonly onChange: (principalId: string) => void;
  /** Marks the signed-in person "(you)". */
  readonly meUserId?: string | undefined;
}

/**
 * Pick who someone reports to: the people, then the agents of the chart, each with its title; the places the org
 * rules refuse are shown disabled with the reason. A native select, so it works the same by keyboard, by touch and
 * with a screen reader, and is never cut off inside a card.
 */
export function PrincipalSelect({
  nodes,
  tree,
  subject,
  value,
  onChange,
  meUserId,
  ...rest
}: PrincipalSelectProps) {
  return (
    <Select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={managerOptions(nodes, tree, subject, meUserId)}
      {...rest}
    />
  );
}

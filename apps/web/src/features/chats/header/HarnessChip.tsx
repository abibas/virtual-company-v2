import type { Harness } from '@mwc/shared/enums';
import { useMachineChoices } from '../../../api/org.ts';
import { useCompany } from '../../../app/company.ts';
import { companyPath } from '../../../app/nav.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { HARNESS_TOOL, machineToolsHref, TOOL_LABELS, toolState } from '../../machines/tools/tools-text.ts';
import { HEADER_CONTROL } from './ChatBar.tsx';

/** The state's colours (its dot, its words), and the words after the CLI's name. */
type Look = { readonly tone: Tone; readonly words: string };
type Tone = { readonly dot: string; readonly text?: string };

/** Green when current, grey offline, amber with an update or an old runner, red when missing. */
const TONES = {
  ok: { dot: 'bg-done' },
  off: { dot: 'bg-faint' },
  warn: { dot: 'bg-input', text: 'text-input' },
  bad: { dot: 'bg-failed', text: 'text-failed' },
} as const satisfies Record<string, Tone>;

/**
 * Beside the chat's profile picker: the chat's harness CLI on the agent's machine ("Codex 0.162.1 · Airia devbox"),
 * amber with "update available" when older than the version the server installs, red "not installed" when missing,
 * linking to the machine's Tools part on the Machines page. Nothing until the machines are loaded.
 */
export function HarnessChip({
  companyId,
  machineId,
  harness,
}: {
  readonly companyId: string;
  readonly machineId: string;
  readonly harness: Harness;
}) {
  const { slug } = useCompany().membership;
  const machines = useMachineChoices(companyId);
  const machine = machines.data?.find((one) => one.id === machineId);
  if (machine === undefined) return null;
  const tool = HARNESS_TOOL[harness];
  const name = TOOL_LABELS[tool];
  const { tools } = machine.runner;
  let look: Look;
  if (machine.status !== 'online') look = { tone: TONES.off, words: `${name} · offline` };
  else if (!tools) look = { tone: TONES.warn, words: `${name} · runner out of date` };
  else {
    const state = toolState(tools, machine.runner.toolsLatest, tool);
    if (state.kind === 'missing') look = { tone: TONES.bad, words: `${name} not installed` };
    else if (state.kind === 'old')
      look = { tone: TONES.warn, words: `${name} ${state.version} · update available` };
    else look = { tone: TONES.ok, words: `${name} ${state.version}` };
  }
  return (
    <Link
      to={machineToolsHref(companyPath(slug, 'machines'), machine.id)}
      title={`${name} on ${machine.name}: open its tools on the Machines page`}
      className={cx(HEADER_CONTROL, 'max-w-60')}
    >
      <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', look.tone.dot)} />
      <span className={cx('truncate', look.tone.text)}>
        {look.words} · {machine.name}
      </span>
    </Link>
  );
}

import { type ResumeMachine, resumeCommands } from '@mwc/shared/resume';
import { SquareArrowOutUpRight } from 'lucide-react';
import { useId } from 'react';
import { useMachines } from '../../../api/machines.ts';
import type { AgentPlacement, Chat } from '../../../api/types.ts';
import { useFloatingPanel } from '../../../components/forms/floating.ts';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { usePopover } from '../context/use-popover.ts';
import { CopyAction } from '../thread/markdown/CopyAction.tsx';

/** What resuming the chat needs: its conversation, the folder it began in, and the agent's config folder. */
export interface ResumeFacts {
  readonly companyId: string;
  readonly chat: Chat;
  readonly placement: AgentPlacement | undefined;
  /** The folder the conversation began in (its last `init`'s), when the harness said. */
  readonly sessionCwd: string | undefined;
}

/** The folder to resume in: the conversation's own, else the agent's home while it is still on the chat's machine. */
function folderOf({ chat, placement, sessionCwd }: ResumeFacts): string | undefined {
  if (sessionCwd) return sessionCwd;
  return placement && placement.machineId === chat.machineId ? placement.home : undefined;
}

/** The commands with their copy buttons, once the machines are loaded (the panel's content, read when it opens). */
function Commands({
  facts,
  folder,
  sessionId,
}: {
  readonly facts: ResumeFacts;
  readonly folder: string;
  readonly sessionId: string;
}) {
  const machines = useMachines(facts.companyId);
  const found = machines.data?.machines.find((machine) => machine.id === facts.chat.machineId);
  const machine: ResumeMachine | undefined = found && {
    name: found.name,
    kind: found.kind,
    provider: found.provider,
    hostname: found.hostname,
  };
  const { chat, placement } = facts;
  const configDir = placement && placement.machineId === chat.machineId ? placement.configDir : null;
  const commands = resumeCommands({ harness: chat.harness, sessionId, folder, configDir, machine });
  const tool = chat.harness === 'codex' ? 'Codex' : 'Claude Code';
  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold text-ink">Open this conversation in {tool}</p>
      {machines.data === undefined && !machines.error ? (
        <p className="text-xs text-dim">Finding the machine…</p>
      ) : (
        <ul className="grid gap-2.5">
          {commands.map((command) => (
            <li key={command.command} className="grid gap-1">
              <span className="text-2xs text-dim">{command.where}</span>
              <div className="flex items-start gap-1 rounded-lg bg-surface-2 py-1.5 pr-1 pl-2.5 ring-1 ring-line ring-inset">
                <code className="min-w-0 flex-1 font-mono text-2xs leading-5 break-all text-ink">
                  {command.command}
                </code>
                <CopyAction text={command.command} label="Copy the command" />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-2xs leading-relaxed text-dim">
        It uses that machine's own {tool} login, not this chat's access profile, and typing there spends it.
        {chat.harness === 'codex' &&
          ' Codex keeps this thread in the runner’s own folder unless the agent has a config folder, so set CODEX_HOME to it, or use the Terminal tab.'}
      </p>
    </div>
  );
}

/**
 * "Open in Claude Code" in the chat's header (S5.2 step 6): an icon button (its name in a tooltip) with a popover of the commands that resume the
 * chat's conversation in the person's own terminal, on its machine and in its folder (`@mwc/shared/resume`), each with
 * a copy button. Hidden before the first turn (no conversation yet) and when the folder is not known.
 */
export function OpenInClaudeCode(facts: ResumeFacts) {
  const popover = usePopover();
  const id = useId();
  const place = useFloatingPanel(popover.open, 'end', popover.trigger, popover.panel, popover.close);
  const folder = folderOf(facts);
  const sessionId = facts.chat.sessionId;
  if (sessionId === null || folder === undefined) return null;
  const label = facts.chat.harness === 'codex' ? 'Open in Codex' : 'Open in Claude Code';
  return (
    <div ref={popover.root}>
      <IconButton
        ref={popover.trigger}
        label={label}
        icon={SquareArrowOutUpRight}
        tone="soft"
        size="sm"
        round
        tooltip="bottom-end"
        aria-expanded={popover.open}
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => popover.setOpen((was) => !was)}
      />
      <div
        ref={popover.panel}
        id={id}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        hidden={!popover.open}
        onKeyDown={popover.trap}
        style={place}
        className="scroll-quiet z-40 max-h-[calc(100dvh-2rem)] w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl bg-surface p-4 shadow-float ring-1 ring-line outline-none"
      >
        {popover.open && <Commands facts={facts} folder={folder} sessionId={sessionId} />}
      </div>
    </div>
  );
}

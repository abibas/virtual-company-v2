import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { RotateCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Machine } from '../../../api/types.ts';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { Badge, type Tone } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { type TerminalStatus, useTerminalSession } from './use-terminal.ts';
import { TERMINAL_BACKGROUND, XTERM_OPTIONS } from './xterm-options.ts';

/** The status line's badge: connecting, connected with its shell, or how it ended. */
function statusBadge(status: TerminalStatus): { readonly tone: Tone; readonly text: string } {
  switch (status.kind) {
    case 'idle':
    case 'connecting':
      return { tone: 'pending', text: 'Connecting…' };
    case 'connected':
      return { tone: 'done', text: `Connected · ${status.shell}` };
    case 'ended':
      return { tone: status.failed ? 'failed' : 'neutral', text: `Ended · ${status.reason}` };
  }
}

/** The status line, with Reconnect (a new ticket) once the terminal ended. */
function StatusRow({
  status,
  onReconnect,
}: {
  readonly status: TerminalStatus;
  readonly onReconnect: () => void;
}) {
  const badge = statusBadge(status);
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
      <output aria-live="polite" className="min-w-0">
        <Badge tone={badge.tone} dot className="max-w-full truncate">
          {badge.text}
        </Badge>
      </output>
      {status.kind === 'ended' && (
        <Button size="sm" icon={RotateCw} onClick={onReconnect}>
          Reconnect
        </Button>
      )}
    </div>
  );
}

/**
 * xterm.js on the session: fitted to its box on open and on every resize (each new size goes to the shell), keystrokes
 * to the socket, and Escape kept inside (the sheet would close on it; vim needs it). The first size opens the terminal.
 */
function TerminalPanel({ companyId, machineId }: { readonly companyId: string; readonly machineId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const { status, open, send, resize, close } = useTerminalSession(companyId, machineId, (bytes) =>
    term.current?.write(bytes),
  );

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const terminal = new Terminal(XTERM_OPTIONS);
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    fit.fit();
    term.current = terminal;
    const typed = terminal.onData(send);
    const resized = terminal.onResize(resize);
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    const keepEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopPropagation();
    };
    element.addEventListener('keydown', keepEscape);
    open({ cols: terminal.cols, rows: terminal.rows });
    return () => {
      close();
      element.removeEventListener('keydown', keepEscape);
      observer.disconnect();
      typed.dispose();
      resized.dispose();
      term.current = null;
      terminal.dispose();
    };
  }, [open, send, resize, close]);

  // The sheet takes the focus when it opens; the shell gets it once it is there, with the size it has by then.
  useEffect(() => {
    const terminal = term.current;
    if (status.kind !== 'connected' || !terminal) return;
    terminal.focus();
    resize({ cols: terminal.cols, rows: terminal.rows });
  }, [status.kind, resize]);

  const reconnect = () => {
    const terminal = term.current;
    if (!terminal) return;
    terminal.reset();
    open({ cols: terminal.cols, rows: terminal.rows });
  };
  return (
    <div className="flex h-[70dvh] flex-col gap-3 sm:h-full">
      <StatusRow status={status} onReconnect={reconnect} />
      <div
        ref={host}
        className="min-h-0 flex-1 overflow-hidden rounded-xl p-2"
        style={{ backgroundColor: TERMINAL_BACKGROUND }}
      />
    </div>
  );
}

/**
 * "Terminal · <machine>": a shell on the machine in the page, as its runner's user. Closing the sheet closes the
 * socket, which ends the shell on the machine.
 */
export function TerminalSheet({
  companyId,
  machine,
  onClose,
}: {
  readonly companyId: string;
  readonly machine: Machine;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={`Terminal · ${machine.name}`}
      description={`A shell as ${machine.unixUser} on ${machine.hostname}, with that user's rights. Closing this ends it.`}
    >
      <TerminalPanel companyId={companyId} machineId={machine.id} />
    </Sheet>
  );
}

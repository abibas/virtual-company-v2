import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { RotateCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cx } from '../../../components/cx.ts';
import { Badge, type Tone } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { type TerminalStatus, type TicketSource, useTerminalSession } from './use-terminal.ts';
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
 * to the socket, and Escape kept inside (a sheet would close on it; vim needs it). The first size opens the terminal.
 * `getTicket` gives each ticket: a machine's shell (the machine card's sheet) or a chat's harness TUI (the chat page).
 */
export function TerminalPanel({
  getTicket,
  describeError,
  className,
}: {
  readonly getTicket: TicketSource;
  /** Words a refused ticket; the machine terminal's words by default. */
  readonly describeError?: (error: unknown) => string;
  /** The panel's height and frame; a sheet's by default. */
  readonly className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const { status, open, send, resize, close } = useTerminalSession(
    getTicket,
    (bytes) => term.current?.write(bytes),
    describeError,
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

  // A sheet takes the focus when it opens; the shell gets it once it is there, with the size it has by then.
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
    <div className={cx('flex flex-col gap-3', className ?? 'h-[70dvh] sm:h-full')}>
      <StatusRow status={status} onReconnect={reconnect} />
      {/* The terminal sits absolutely inside its box, so its rows can never push the box taller than the space it
          was given: fit then always sizes it to what is visible, the last line included. */}
      <div
        className="relative min-h-48 flex-1 overflow-hidden rounded-xl"
        style={{ backgroundColor: TERMINAL_BACKGROUND }}
      >
        <div ref={host} className="absolute inset-2" />
      </div>
    </div>
  );
}

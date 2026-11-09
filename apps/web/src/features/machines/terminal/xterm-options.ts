import type { ITerminalOptions } from '@xterm/xterm';

/**
 * The terminal's look: always the dark palette of the page's tokens (`styles/tokens.css`, dark), whatever the page's
 * theme, in the page's mono font (`--font-mono`).
 */
export const TERMINAL_BACKGROUND = '#0d1020';

export const XTERM_OPTIONS: ITerminalOptions = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.15,
  cursorBlink: true,
  scrollback: 5000,
  theme: {
    background: TERMINAL_BACKGROUND,
    foreground: '#eef0fb',
    cursor: '#5d87ff',
    cursorAccent: TERMINAL_BACKGROUND,
    selectionBackground: 'rgba(93, 135, 255, 0.35)',
    black: '#252b45',
    red: '#ff6b78',
    green: '#3fc27a',
    yellow: '#f0a63a',
    blue: '#5d87ff',
    magenta: '#a08cff',
    cyan: '#2ccbb7',
    white: '#c4c9e1',
    brightBlack: '#5e6487',
    brightRed: '#ff7a60',
    brightGreen: '#5fd895',
    brightYellow: '#f5bd65',
    brightBlue: '#86a6ff',
    brightMagenta: '#bcaeff',
    brightCyan: '#5fdccb',
    brightWhite: '#eef0fb',
  },
};

import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.ts';

describe('parseArgs', () => {
  it('takes the first bare word as the command and the rest as positionals', () => {
    const parsed = parseArgs(['ports', 'a', 'b']);
    expect(parsed.command).toBe('ports');
    expect(parsed.positionals).toEqual(['a', 'b']);
  });

  it('reads flags, --name value and --name=value', () => {
    const parsed = parseArgs(['check', '--fast', '--slot', '3', '--path=/tmp/x', '--full']);
    expect(parsed.flags).toEqual(new Set(['fast', 'full']));
    expect(parsed.options).toEqual({ slot: '3', path: '/tmp/x' });
  });

  it('does not swallow a following option as a value', () => {
    const parsed = parseArgs(['--fast', '--slot=1']);
    expect(parsed.command).toBeUndefined();
    expect(parsed.flags.has('fast')).toBe(true);
    expect(parsed.options.slot).toBe('1');
  });

  it('returns an empty result for no arguments', () => {
    expect(parseArgs([])).toEqual({ command: undefined, positionals: [], flags: new Set(), options: {} });
  });
});

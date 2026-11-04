import { describe, expect, it } from 'vitest';
import { closingParen, functionSpans, headerOf, MAX_HEADER_LINES } from '../../src/structure/functions.ts';

/** `name: first-last` for each span. */
const spans = (text: string) => functionSpans(text).map((s) => `${s.name}: ${s.line}-${s.end}`);

describe('functionSpans: named functions with a block body, first to last line', () => {
  it('measures declarations, exported, async, generator and default ones', () => {
    const text = [
      'export function a(x: number): number {',
      '  return x;',
      '}',
      'async function b() {',
      '  await c();',
      '}',
      'function* gen<T>(items: T[]) {',
      '  yield* items;',
      '}',
      'export default function () {',
      '  return 1;',
      '}',
    ].join('\n');
    expect(spans(text)).toEqual(['a: 1-3', 'b: 4-6', 'gen: 7-9', 'default: 10-12']);
  });

  it('measures arrow functions and function expressions assigned to a name or a property', () => {
    const text = [
      'export const run = async (flags: Set<string>): Promise<number> => {',
      '  return 0;',
      '};',
      'const one = async (x) => {',
      '  return x;',
      '};',
      'const bare = x => {',
      '  return x;',
      '};',
      'let old = function named(a) {',
      '  return a;',
      '};',
      'const deps = {',
      '  listFiles: () => {',
      '    return [];',
      '  },',
      '  read: async function (path) {',
      '    return path;',
      '  },',
      '};',
    ].join('\n');
    expect(spans(text)).toEqual([
      'run: 1-3',
      'one: 4-6',
      'bare: 7-9',
      'old: 10-12',
      'listFiles: 14-16',
      'read: 17-19',
    ]);
  });

  it('measures methods of classes and object literals, with their modifiers', () => {
    const text = [
      'export class Fake {',
      '  constructor(private readonly world: World) {',
      '    this.world = world;',
      '  }',
      '  async verify(token: string): Promise<string> {',
      '    return token;',
      '  }',
      '  static get(id: string) {',
      '    return id;',
      '  }',
      '  get size() {',
      '    return 0;',
      '  }',
      '}',
      'return {',
      '  text(path) {',
      '    return path;',
      '  },',
      '};',
    ].join('\n');
    expect(spans(text)).toEqual([
      'constructor: 2-4',
      'verify: 5-7',
      'get: 8-10',
      'size: 11-13',
      'text: 16-18',
    ]);
  });

  it('follows a parameter list over several lines, skipping parentheses in strings and comments', () => {
    const text = [
      'export function checkSteps(',
      '  flags: ReadonlySet<string>, // a ( in a comment',
      "  label = ')', other = \"(\", tpl = `)`, quoted = 'it\\'s (',",
      '): CheckStep[] {',
      '  const steps = [];',
      '  return steps;',
      '}',
    ].join('\n');
    expect(spans(text)).toEqual(['checkSteps: 1-7']);
  });

  it('counts nested named functions on their own, and the outer one with them', () => {
    const text = [
      'function outer() {',
      '  function inner() {',
      '    return 1;',
      '  }',
      '  return inner();',
      '}',
    ].join('\n');
    expect(spans(text)).toEqual(['outer: 1-6', 'inner: 2-4']);
  });

  it('leaves out callbacks, expression bodies, one-liners, signatures, statements and comments', () => {
    const text = [
      "describe('a (group)', () => {",
      "  it('works', async () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      'items.map((item) => {',
      '  return item;',
      '});',
      'const short = (x) =>',
      '  x + 1;',
      'const object = () => ({',
      '  a: 1,',
      '});',
      'function oneLine() { return 1; }',
      'interface Io {',
      '  stdout(s: string): void;',
      '  run: (io: Io) => boolean;',
      '}',
      'if (ready) {',
      '  go();',
      '}',
      'for (const x of xs) {',
      '}',
      'while (busy()) {',
      '}',
      'switch (kind) {',
      '}',
      'async (c) => {',
      '};',
      'function (a) {',
      '}',
      '// function commented() {',
      ' * method() {',
      'expect(value).toEqual({',
      '});',
    ].join('\n');
    expect(spans(text)).toEqual([]);
  });

  it('takes a trailing comment after the opening brace, and skips a body that never closes', () => {
    expect(spans(['function a() { // why', '  go();', '}'].join('\n'))).toEqual(['a: 1-3']);
    expect(spans(['function open() {', '  go();'].join('\n'))).toEqual([]);
  });
});

describe('helpers', () => {
  it('reads the name, the column of the parameter list and the kind of a header', () => {
    expect(headerOf('export function a(x) {')).toEqual({ name: 'a', open: 17, arrow: false });
    expect(headerOf('const f = (x) => {')).toEqual({ name: 'f', open: 10, arrow: true });
    expect(headerOf('listFiles: function () {')).toEqual({ name: 'listFiles', open: 20, arrow: false });
    expect(headerOf('if (x) {')).toBeUndefined();
    expect(headerOf('function (x) {')).toBeUndefined();
    expect(headerOf('return x;')).toBeUndefined();
  });

  it(`finds the closing parenthesis within ${MAX_HEADER_LINES} lines, across lines and around strings`, () => {
    expect(closingParen(['f(a, (b)) {'], 0, 1)).toEqual({ line: 0, col: 9 });
    expect(closingParen(['f(', "  ')',", ') {'], 0, 1)).toEqual({ line: 2, col: 1 });
    expect(closingParen(["f('unclosed", ') {'], 0, 1)).toEqual({ line: 1, col: 1 });
    const long = ['f(', ...Array.from({ length: MAX_HEADER_LINES }, () => '  a,'), ') {'];
    expect(closingParen(long, 0, 1)).toBeUndefined();
  });
});

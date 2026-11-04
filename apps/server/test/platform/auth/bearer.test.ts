import { describe, expect, it } from 'vitest';
import { classifyBearer, readBearer } from '../../../src/platform/auth/bearer.ts';

const jwt = (payload: unknown) =>
  ['eyJhbGciOiJFZERTQSJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

describe('readBearer', () => {
  it.each([
    ['Bearer abc.def', 'abc.def'],
    ['bearer abc', 'abc'],
    ['BEARER   abc  ', 'abc'],
  ])('reads %j', (header, token) => {
    expect(readBearer(header)).toBe(token);
  });

  it.each([undefined, '', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', 'Bearer two tokens', 'Token abc'])(
    'finds no bearer token in %j',
    (header) => {
      expect(readBearer(header)).toBeNull();
    },
  );
});

describe('classifyBearer', () => {
  it('sorts API keys, run tokens and session tokens by their shape', () => {
    expect(classifyBearer('mwc_pk_abc')).toBe('api_key');
    expect(classifyBearer('mwc_zz_anything')).toBe('api_key');
    expect(classifyBearer(jwt({ typ: 'run', rid: 'r1' }))).toBe('run_token');
    expect(classifyBearer(jwt({ sub: 'user_1', sts: 'active' }))).toBe('session');
    expect(classifyBearer(jwt('typ'))).toBe('session');
    expect(classifyBearer(jwt(null))).toBe('session');
    expect(classifyBearer('a.not-json.c')).toBe('session');
    expect(classifyBearer('fake:u1')).toBe('session');
  });
});

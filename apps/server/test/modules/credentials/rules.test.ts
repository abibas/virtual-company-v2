import { describe, expect, it } from 'vitest';
import {
  audited,
  CREDENTIAL_NOT_FOUND,
  credentialAad,
  labelFits,
  pastedCredential,
  purposeFits,
  USE_NOT_FOUND,
  USE_REVOKED,
} from '../../../src/modules/credentials/rules.ts';

const ID = '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b';
const OWNER = '019a5a10-0000-7000-8000-000000000001';

describe('credentialAad', () => {
  it('binds a secret to its id, owner and kind', () => {
    expect(credentialAad({ id: ID, ownerUserId: OWNER, kind: 'gateway' })).toBe(
      `credential|${ID}|${OWNER}|gateway`,
    );
  });
});

describe('pastedCredential', () => {
  it('seals the token or key and shows nothing else', () => {
    expect(pastedCredential({ kind: 'claude_setup_token', label: 'Max', token: 'sk-ant-oat01-t' })).toEqual({
      kind: 'claude_setup_token',
      secret: { token: 'sk-ant-oat01-t' },
      label: 'Max',
      accountMeta: {},
    });
    expect(pastedCredential({ kind: 'anthropic_api_key', label: 'A', apiKey: 'sk-ant-api03-k' })).toEqual({
      kind: 'anthropic_api_key',
      secret: { apiKey: 'sk-ant-api03-k' },
      label: 'A',
      accountMeta: {},
    });
    expect(pastedCredential({ kind: 'openai_api_key', label: 'O', apiKey: 'sk-k' })).toMatchObject({
      secret: { apiKey: 'sk-k' },
      accountMeta: {},
    });
  });

  it("seals a gateway's headers and shows its address", () => {
    const body = {
      kind: 'gateway',
      label: 'G',
      baseUrl: 'http://localhost:8300',
      headers: { 'x-api-key': 'k' },
    } as const;
    expect(pastedCredential(body)).toEqual({
      kind: 'gateway',
      secret: { headers: { 'x-api-key': 'k' } },
      label: 'G',
      accountMeta: { baseUrl: 'http://localhost:8300' },
    });
  });
});

describe('limits and audit fields', () => {
  it('takes a trimmed name of 1 to 80 characters and a purpose of 1 to 80', () => {
    expect([
      labelFits('a'),
      labelFits('x'.repeat(80)),
      labelFits(''),
      labelFits(' a'),
      labelFits('x'.repeat(81)),
    ]).toEqual([true, true, false, false, false]);
    expect([purposeFits('run'), purposeFits(''), purposeFits('p'.repeat(81))]).toEqual([true, false, false]);
  });

  it('audits the metadata, never a sealed column', () => {
    const row = {
      id: ID,
      ownerUserId: OWNER,
      kind: 'claude_setup_token' as const,
      label: 'Max',
      accountEmail: null,
      accountMeta: {},
      status: 'active' as const,
      iv: new Uint8Array(12),
      authTag: new Uint8Array(16),
      ciphertext: new Uint8Array(8),
    };
    expect(audited(row)).toEqual({
      ownerUserId: OWNER,
      kind: 'claude_setup_token',
      label: 'Max',
      accountEmail: null,
      accountMeta: {},
      status: 'active',
    });
  });

  it('refuses with codes the routes and callers can tell apart', () => {
    expect(CREDENTIAL_NOT_FOUND).toMatchObject({ status: 404, code: 'credential_not_found' });
    expect([USE_NOT_FOUND.code, USE_REVOKED.code]).toEqual(['credential_not_found', 'credential_revoked']);
  });
});

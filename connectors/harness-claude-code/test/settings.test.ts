import { describe, expect, it } from 'vitest';
import {
  customHeaders,
  DIRECT_BASE_URL,
  SETTINGS_OPTION,
  settingsDir,
  settingsEnv,
  settingsFile,
} from '../src/settings.ts';

const GATEWAY = {
  baseUrl: 'http://127.0.0.1:8300',
  headers: { 'x-memory-agent': 'slop', 'X-Api-Key': 'gw-key' },
};

describe('customHeaders', () => {
  it('puts one Name: value a line, nothing for no headers', () => {
    expect(customHeaders({})).toBe('');
    expect(customHeaders({ A: '1' })).toBe('A: 1');
    expect(customHeaders(GATEWAY.headers)).toBe('x-memory-agent: slop\nX-Api-Key: gw-key');
  });
});

describe('settingsEnv', () => {
  it('sends the requests through the profile’s gateway, with its headers', () => {
    expect(settingsEnv(GATEWAY)).toEqual({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300',
      ANTHROPIC_CUSTOM_HEADERS: 'x-memory-agent: slop\nX-Api-Key: gw-key',
    });
    expect(settingsEnv({ baseUrl: 'https://gw.example.com', headers: {} })).toEqual({
      ANTHROPIC_BASE_URL: 'https://gw.example.com',
      ANTHROPIC_CUSTOM_HEADERS: '',
    });
  });

  it('without a gateway, sends them to Anthropic itself with no headers, so a machine’s own gateway is not used', () => {
    expect(DIRECT_BASE_URL).toBe('https://api.anthropic.com');
    expect(settingsEnv(null)).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_CUSTOM_HEADERS: '',
    });
  });
});

describe('settingsFile', () => {
  it('is a 0600 JSON settings file named with --settings, of its own name each time', () => {
    const file = settingsFile(GATEWAY);
    expect(file).toEqual({
      name: expect.stringMatching(/^settings-[0-9a-f]{12}\.json$/),
      contents: expect.any(String),
      mode: 0o600,
      option: '--settings',
    });
    expect(SETTINGS_OPTION).toBe('--settings');
    expect(JSON.parse(file.contents)).toEqual({ env: settingsEnv(GATEWAY) });
    expect(file.name).not.toContain('gw-key');
    expect(settingsFile(GATEWAY).name).not.toBe(file.name);
    expect(JSON.parse(settingsFile(null).contents)).toEqual({
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_CUSTOM_HEADERS: '' },
    });
  });

  it('goes in the runner’s own private folder, with no variable naming it', () => {
    const dir = settingsDir(null);
    expect(dir).toEqual({
      path: null,
      files: [expect.objectContaining({ option: '--settings', mode: 0o600 })],
    });
    expect(dir).not.toHaveProperty('env');
  });
});

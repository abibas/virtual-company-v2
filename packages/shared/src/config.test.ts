import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const valid = { DATABASE_URL: 'postgres://mwc:mwc@localhost:9952/mwc' };

describe('loadConfig', () => {
  it('applies the defaults when only DATABASE_URL is given', () => {
    const config = loadConfig(valid);
    expect(config).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: valid.DATABASE_URL,
      MWC_PORT: 9950,
      MWC_PUBLIC_URL: 'http://localhost:9950',
      MWC_LOG_LEVEL: 'info',
    });
  });

  it('rejects a missing DATABASE_URL and names it', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x/y' })).toThrow(/DATABASE_URL/);
  });

  it('coerces MWC_PORT from a string and rejects values outside the TCP range', () => {
    expect(loadConfig({ ...valid, MWC_PORT: '9960' }).MWC_PORT).toBe(9960);
    expect(() => loadConfig({ ...valid, MWC_PORT: '70000' })).toThrow(/MWC_PORT/);
    expect(() => loadConfig({ ...valid, MWC_PORT: 'nine' })).toThrow(/MWC_PORT/);
  });

  it('lists every problem at once', () => {
    try {
      loadConfig({ MWC_PORT: '0', MWC_PORT_SLOT: '10', MWC_LOG_LEVEL: 'loud' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const paths = (error as ConfigError).issues.map((issue) => issue.path).sort();
      expect(paths).toEqual(['DATABASE_URL', 'MWC_LOG_LEVEL', 'MWC_PORT', 'MWC_PORT_SLOT']);
    }
  });
});

describe('loadConfig with MWC_PORT_SLOT', () => {
  it("uses the slot's API port and public URL when MWC_PORT is not set", () => {
    const config = loadConfig({ ...valid, MWC_PORT_SLOT: '3' });
    expect(config.MWC_PORT_SLOT).toBe(3);
    expect(config.MWC_PORT).toBe(9969);
    expect(config.MWC_PUBLIC_URL).toBe('http://localhost:9969');
  });

  it('lets an explicit MWC_PORT win over the slot', () => {
    const config = loadConfig({ ...valid, MWC_PORT_SLOT: '3', MWC_PORT: '9950' });
    expect(config.MWC_PORT).toBe(9950);
    expect(config.MWC_PUBLIC_URL).toBe('http://localhost:9950');
  });

  it('derives the default public URL from the effective port, and an explicit one wins', () => {
    expect(loadConfig({ ...valid, MWC_PORT: '9993' }).MWC_PUBLIC_URL).toBe('http://localhost:9993');
    const explicit = loadConfig({ ...valid, MWC_PORT_SLOT: '1', MWC_PUBLIC_URL: 'https://mwc.example.com' });
    expect(explicit.MWC_PORT).toBe(9963);
    expect(explicit.MWC_PUBLIC_URL).toBe('https://mwc.example.com');
  });

  it('rejects slots outside 0..9 and non-integers', () => {
    for (const slot of ['10', '-1', '1.5', 'x']) {
      expect(() => loadConfig({ ...valid, MWC_PORT_SLOT: slot })).toThrow(/MWC_PORT_SLOT/);
    }
    expect(loadConfig({ ...valid, MWC_PORT_SLOT: '0' }).MWC_PORT).toBe(9960);
    expect(loadConfig({ ...valid, MWC_PORT_SLOT: '9' }).MWC_PORT).toBe(9987);
  });

  it('treats an empty variable as unset', () => {
    const config = loadConfig({ ...valid, MWC_PORT_SLOT: '', MWC_PORT: '', MWC_PUBLIC_URL: '' });
    expect(config.MWC_PORT_SLOT).toBeUndefined();
    expect(config.MWC_PORT).toBe(9950);
    expect(config.MWC_PUBLIC_URL).toBe('http://localhost:9950');
  });
});

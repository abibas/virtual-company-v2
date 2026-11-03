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
      loadConfig({ MWC_PORT: '0', MWC_LOG_LEVEL: 'loud' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const paths = (error as ConfigError).issues.map((issue) => issue.path).sort();
      expect(paths).toEqual(['DATABASE_URL', 'MWC_LOG_LEVEL', 'MWC_PORT']);
    }
  });
});

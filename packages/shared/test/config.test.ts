import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CLERK_SECRET_KEY_PATTERN, ConfigError, decodeMasterKey, loadConfig } from '../src/config.ts';

const valid = { DATABASE_URL: 'postgres://mwc:mwc@localhost:9952/mwc' };
/** A master key made for this run only: production refuses to start without one. */
const MASTER_KEY = randomBytes(32).toString('base64');
const PRODUCTION = { NODE_ENV: 'production', MWC_MASTER_KEY: MASTER_KEY };

describe('loadConfig', () => {
  it('applies the defaults when only DATABASE_URL is given', () => {
    const config = loadConfig(valid);
    expect(config).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: valid.DATABASE_URL,
      MWC_PORT: 9950,
      MWC_PUBLIC_URL: 'http://localhost:9950',
      MWC_PUBLIC_URL_SET: false,
      MWC_LOG_LEVEL: 'info',
      MWC_HOST: '127.0.0.1',
      MWC_MIGRATE_ON_START: false,
      MWC_WEB_ORIGIN: 'http://localhost:9951',
      MWC_IDENTITY: 'none',
      MWC_COMPANY_CREATION: 'any',
      MWC_COMPANY_CREATORS: [],
      MWC_JOBS: true,
      MWC_RECONCILE_MINUTES: 10,
      MWC_LOGIN_HELPER: 'docker',
      MWC_LOCAL_POWER: 'auto',
      MWC_LOCAL_DOCKER: 'auto',
      MWC_WHISPER: 'auto',
      MWC_WHISPER_LANGUAGE: 'auto',
      MWC_WHISPER_PORT: 9957,
      MWC_EMAIL: 'outbox',
      MWC_EMAIL_FROM: 'Most Wanted Corp <no-reply@localhost>',
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

describe('loadConfig MWC_HOST and MWC_MIGRATE_ON_START', () => {
  it('accepts an IPv4, IPv6 or host name for MWC_HOST and treats empty as the loopback default', () => {
    for (const host of ['0.0.0.0', '127.0.0.1', '::', '::1', 'localhost', 'server.internal']) {
      expect(loadConfig({ ...valid, MWC_HOST: host }).MWC_HOST).toBe(host);
    }
    expect(loadConfig({ ...valid, MWC_HOST: '' }).MWC_HOST).toBe('127.0.0.1');
  });

  it('rejects an MWC_HOST that is not an address or host name', () => {
    for (const host of ['http://0.0.0.0', 'a b', '0.0.0.0:9950']) {
      expect(() => loadConfig({ ...valid, MWC_HOST: host })).toThrow(/MWC_HOST/);
    }
  });

  it('parses MWC_MIGRATE_ON_START as a boolean, false when unset or empty', () => {
    for (const on of ['true', '1', 'yes', 'on']) {
      expect(loadConfig({ ...valid, MWC_MIGRATE_ON_START: on }).MWC_MIGRATE_ON_START).toBe(true);
    }
    for (const off of ['false', '0', 'no', 'off', '']) {
      expect(loadConfig({ ...valid, MWC_MIGRATE_ON_START: off }).MWC_MIGRATE_ON_START).toBe(false);
    }
    expect(loadConfig(valid).MWC_MIGRATE_ON_START).toBe(false);
    expect(() => loadConfig({ ...valid, MWC_MIGRATE_ON_START: 'maybe' })).toThrow(/MWC_MIGRATE_ON_START/);
  });
});

describe('loadConfig MWC_WEB_DIST', () => {
  it('is unset by default and when empty, and kept as given otherwise', () => {
    expect(loadConfig(valid).MWC_WEB_DIST).toBeUndefined();
    expect(loadConfig({ ...valid, MWC_WEB_DIST: '' }).MWC_WEB_DIST).toBeUndefined();
    expect(loadConfig({ ...valid, MWC_WEB_DIST: '/app/apps/web/dist' }).MWC_WEB_DIST).toBe(
      '/app/apps/web/dist',
    );
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
    expect(explicit.MWC_PUBLIC_URL_SET).toBe(true);
    expect(loadConfig({ ...valid, MWC_PUBLIC_URL: '' }).MWC_PUBLIC_URL_SET).toBe(false);
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

const SECRET = `sk_test_${'A1'.repeat(20)}`;
const PUBLISHABLE = `pk_test_${Buffer.from('config-test.clerk.accounts.dev$').toString('base64')}`;

describe('loadConfig identity', () => {
  it('is none without a Clerk secret key, and clerk with both keys', () => {
    expect(loadConfig(valid).MWC_IDENTITY).toBe('none');
    const clerk = loadConfig({ ...valid, CLERK_SECRET_KEY: SECRET, CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
    expect(clerk).toMatchObject({
      MWC_IDENTITY: 'clerk',
      CLERK_SECRET_KEY: SECRET,
      CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
    });
    expect(clerk.CLERK_JWT_KEY).toBeUndefined();
    expect(clerk.CLERK_WEBHOOK_SIGNING_SECRET).toBeUndefined();
  });

  it('keeps the optional webhook signing secret (its shape is the connector’s to check)', () => {
    const env = { ...valid, CLERK_SECRET_KEY: SECRET, CLERK_PUBLISHABLE_KEY: PUBLISHABLE };
    const secret = `whsec_${'c2VjcmV0'.repeat(3)}`;
    expect(loadConfig({ ...env, CLERK_WEBHOOK_SIGNING_SECRET: secret }).CLERK_WEBHOOK_SIGNING_SECRET).toBe(
      secret,
    );
  });

  it('lets MWC_IDENTITY=none switch sign-in off even with the keys set', () => {
    const env = {
      ...valid,
      MWC_IDENTITY: 'none',
      CLERK_SECRET_KEY: SECRET,
      CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
    };
    expect(loadConfig(env).MWC_IDENTITY).toBe('none');
  });

  it('names the missing key for clerk, never a value', () => {
    for (const env of [
      { ...valid, CLERK_SECRET_KEY: SECRET },
      { ...valid, MWC_IDENTITY: 'clerk', CLERK_PUBLISHABLE_KEY: PUBLISHABLE },
    ]) {
      try {
        loadConfig(env);
        expect.unreachable('loadConfig should have thrown');
      } catch (error) {
        const issues = (error as ConfigError).issues;
        expect(issues.map((issue) => issue.path)).toHaveLength(1);
        expect(issues[0]?.message).toBe('required when MWC_IDENTITY is clerk');
        expect((error as Error).message).not.toContain(SECRET);
        expect((error as Error).message).not.toContain(PUBLISHABLE);
      }
    }
    expect(() => loadConfig({ ...valid, MWC_IDENTITY: 'clerk' })).toThrow(/CLERK_SECRET_KEY/);
    expect(() => loadConfig({ ...valid, MWC_IDENTITY: 'okta' })).toThrow(/MWC_IDENTITY/);
  });

  it('stays none for a secret key that is not one (a placeholder), unless MWC_IDENTITY asks for clerk', () => {
    for (const bad of [
      'sk_test_...',
      'paste-the-key-here',
      `sk_prod_${'A1'.repeat(20)}`,
      `sk_test_${'A'.repeat(19)}`,
    ]) {
      expect(CLERK_SECRET_KEY_PATTERN.test(bad)).toBe(false);
      const config = loadConfig({ ...valid, CLERK_SECRET_KEY: bad, CLERK_PUBLISHABLE_KEY: PUBLISHABLE });
      expect(config.MWC_IDENTITY).toBe('none');
      // Asked for explicitly, clerk keeps the key; the connector refuses its shape when the server starts.
      const forced = loadConfig({
        ...valid,
        MWC_IDENTITY: 'clerk',
        CLERK_SECRET_KEY: bad,
        CLERK_PUBLISHABLE_KEY: PUBLISHABLE,
      });
      expect(forced.MWC_IDENTITY).toBe('clerk');
    }
    expect(CLERK_SECRET_KEY_PATTERN.test(SECRET)).toBe(true);
    expect(CLERK_SECRET_KEY_PATTERN.test(`sk_live_${'Zz9'.repeat(7)}`)).toBe(true);
  });

  it('treats empty Clerk variables as unset', () => {
    const config = loadConfig({
      ...valid,
      CLERK_SECRET_KEY: '',
      CLERK_PUBLISHABLE_KEY: '',
      CLERK_JWT_KEY: '',
      CLERK_WEBHOOK_SIGNING_SECRET: '',
    });
    expect(config.MWC_IDENTITY).toBe('none');
    expect(config.CLERK_SECRET_KEY).toBeUndefined();
    expect(config.CLERK_WEBHOOK_SIGNING_SECRET).toBeUndefined();
  });
});

describe('loadConfig MWC_WEB_ORIGIN', () => {
  it("defaults to the web dev server, or the slot's web port", () => {
    expect(loadConfig(valid).MWC_WEB_ORIGIN).toBe('http://localhost:9951');
    expect(loadConfig({ ...valid, MWC_PORT_SLOT: '2' }).MWC_WEB_ORIGIN).toBe('http://localhost:9967');
  });

  it('defaults to the origin of the public URL in production, where the server serves the UI', () => {
    const prod = { ...valid, ...PRODUCTION, MWC_PUBLIC_URL: 'https://mwc.example.com/app/' };
    expect(loadConfig(prod).MWC_WEB_ORIGIN).toBe('https://mwc.example.com');
    expect(loadConfig({ ...valid, ...PRODUCTION, MWC_PORT: '9950' }).MWC_WEB_ORIGIN).toBe(
      'http://localhost:9950',
    );
  });

  it('keeps only the origin of an explicit value and refuses anything but http(s)', () => {
    expect(loadConfig({ ...valid, MWC_WEB_ORIGIN: 'https://app.example.com/' }).MWC_WEB_ORIGIN).toBe(
      'https://app.example.com',
    );
    expect(loadConfig({ ...valid, MWC_WEB_ORIGIN: '' }).MWC_WEB_ORIGIN).toBe('http://localhost:9951');
    for (const origin of ['localhost:9951', 'ftp://x.test']) {
      expect(() => loadConfig({ ...valid, MWC_WEB_ORIGIN: origin })).toThrow(/MWC_WEB_ORIGIN/);
    }
  });
});

describe('loadConfig company creation', () => {
  it('lets anyone create companies by default, and only the listed creators in production', () => {
    expect(loadConfig(valid).MWC_COMPANY_CREATION).toBe('any');
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).MWC_COMPANY_CREATION).toBe('any');
    expect(loadConfig({ ...valid, ...PRODUCTION }).MWC_COMPANY_CREATION).toBe('allowlist');
    expect(loadConfig({ ...valid, MWC_COMPANY_CREATION: '' }).MWC_COMPANY_CREATION).toBe('any');
    for (const mode of ['any', 'allowlist', 'none'] as const) {
      expect(loadConfig({ ...valid, ...PRODUCTION, MWC_COMPANY_CREATION: mode }).MWC_COMPANY_CREATION).toBe(
        mode,
      );
    }
    expect(() => loadConfig({ ...valid, MWC_COMPANY_CREATION: 'some' })).toThrow(/MWC_COMPANY_CREATION/);
  });

  it('reads MWC_COMPANY_CREATORS as trimmed, lower-cased emails and refuses one that is not an email', () => {
    expect(
      loadConfig({ ...valid, MWC_COMPANY_CREATORS: ' Ihor@Example.com, ,b@x.test ' }).MWC_COMPANY_CREATORS,
    ).toEqual(['ihor@example.com', 'b@x.test']);
    expect(loadConfig({ ...valid, MWC_COMPANY_CREATORS: '' }).MWC_COMPANY_CREATORS).toEqual([]);
    expect(() => loadConfig({ ...valid, MWC_COMPANY_CREATORS: 'a@x.test,not-an-email' })).toThrow(
      /MWC_COMPANY_CREATORS/,
    );
  });
});

describe('loadConfig jobs', () => {
  it('runs the jobs loop by default, also in production, and not with NODE_ENV=test unless asked', () => {
    expect(loadConfig(valid).MWC_JOBS).toBe(true);
    expect(loadConfig({ ...valid, ...PRODUCTION }).MWC_JOBS).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).MWC_JOBS).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: 'test', MWC_JOBS: 'on' }).MWC_JOBS).toBe(true);
    expect(loadConfig({ ...valid, MWC_JOBS: '' }).MWC_JOBS).toBe(true);
    for (const off of ['off', 'false', '0', 'no'])
      expect(loadConfig({ ...valid, MWC_JOBS: off }).MWC_JOBS).toBe(false);
    expect(() => loadConfig({ ...valid, MWC_JOBS: 'sometimes' })).toThrow(/MWC_JOBS/);
  });

  it('reconciles each company every 10 minutes unless MWC_RECONCILE_MINUTES says otherwise (1 to 1440)', () => {
    expect(loadConfig({ ...valid, MWC_RECONCILE_MINUTES: '' }).MWC_RECONCILE_MINUTES).toBe(10);
    expect(loadConfig({ ...valid, MWC_RECONCILE_MINUTES: '3' }).MWC_RECONCILE_MINUTES).toBe(3);
    for (const minutes of ['0', '1441', '2.5', 'ten']) {
      expect(() => loadConfig({ ...valid, MWC_RECONCILE_MINUTES: minutes })).toThrow(/MWC_RECONCILE_MINUTES/);
    }
  });
});

describe('loadConfig MWC_LOGIN_HELPER', () => {
  it('is docker in development, none in production and tests, and whatever it names', () => {
    expect(loadConfig(valid).MWC_LOGIN_HELPER).toBe('docker');
    expect(loadConfig({ ...valid, MWC_LOGIN_HELPER: '' }).MWC_LOGIN_HELPER).toBe('docker');
    expect(loadConfig({ ...valid, ...PRODUCTION }).MWC_LOGIN_HELPER).toBe('none');
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).MWC_LOGIN_HELPER).toBe('none');
    expect(loadConfig({ ...valid, ...PRODUCTION, MWC_LOGIN_HELPER: 'local' }).MWC_LOGIN_HELPER).toBe('local');
    expect(loadConfig({ ...valid, MWC_LOGIN_HELPER: 'none' }).MWC_LOGIN_HELPER).toBe('none');
    expect(() => loadConfig({ ...valid, MWC_LOGIN_HELPER: 'podman' })).toThrow(/MWC_LOGIN_HELPER/);
  });
});

describe('loadConfig MWC_LOCAL_POWER', () => {
  it('is auto unless it says on or off, in every environment, and refuses anything else', () => {
    expect(loadConfig(valid).MWC_LOCAL_POWER).toBe('auto');
    expect(loadConfig({ ...valid, MWC_LOCAL_POWER: '' }).MWC_LOCAL_POWER).toBe('auto');
    expect(loadConfig({ ...valid, ...PRODUCTION }).MWC_LOCAL_POWER).toBe('auto');
    expect(loadConfig({ ...valid, MWC_LOCAL_POWER: 'on' }).MWC_LOCAL_POWER).toBe('on');
    expect(loadConfig({ ...valid, ...PRODUCTION, MWC_LOCAL_POWER: 'off' }).MWC_LOCAL_POWER).toBe('off');
    expect(() => loadConfig({ ...valid, MWC_LOCAL_POWER: 'yes' })).toThrow(/MWC_LOCAL_POWER/);
  });
});

describe('loadConfig MWC_WHISPER', () => {
  it('is auto with the language detected and the warm server on 9957 unless told otherwise', () => {
    const config = loadConfig({ ...valid, MWC_WHISPER: '', MWC_WHISPER_MODEL: '', MWC_WHISPER_PROMPT: '' });
    expect(config).toMatchObject({
      MWC_WHISPER: 'auto',
      MWC_WHISPER_LANGUAGE: 'auto',
      MWC_WHISPER_PORT: 9957,
    });
    expect(config.MWC_WHISPER_MODEL).toBeUndefined();
    expect(config.MWC_WHISPER_PROMPT).toBeUndefined();
  });

  it('keeps off, a model path, a language, a prompt and a port as given', () => {
    const config = loadConfig({
      ...valid,
      MWC_WHISPER: 'off',
      MWC_WHISPER_MODEL: '~/models/ggml-base.en.bin',
      MWC_WHISPER_LANGUAGE: 'uk',
      MWC_WHISPER_PROMPT: 'Kyiv, devbox, pull request.',
      MWC_WHISPER_PORT: '9958',
    });
    expect(config).toMatchObject({
      MWC_WHISPER: 'off',
      MWC_WHISPER_MODEL: '~/models/ggml-base.en.bin',
      MWC_WHISPER_LANGUAGE: 'uk',
      MWC_WHISPER_PROMPT: 'Kyiv, devbox, pull request.',
      MWC_WHISPER_PORT: 9958,
    });
  });

  it('refuses another mode, a language that is not a code and a port out of range, naming each', () => {
    expect(() => loadConfig({ ...valid, MWC_WHISPER: 'on' })).toThrow(/MWC_WHISPER:/);
    expect(() => loadConfig({ ...valid, MWC_WHISPER_LANGUAGE: 'English' })).toThrow(/MWC_WHISPER_LANGUAGE/);
    expect(() => loadConfig({ ...valid, MWC_WHISPER_PORT: '70000' })).toThrow(/MWC_WHISPER_PORT/);
  });
});

describe('loadConfig MWC_EMAIL', () => {
  it('writes to the outbox in development and sends nothing elsewhere unless told', () => {
    expect(loadConfig(valid).MWC_EMAIL).toBe('outbox');
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).MWC_EMAIL).toBe('off');
    expect(loadConfig({ ...valid, ...PRODUCTION, MWC_EMAIL: '' }).MWC_EMAIL).toBe('off');
    expect(loadConfig({ ...valid, NODE_ENV: 'test', MWC_EMAIL: 'outbox' }).MWC_EMAIL).toBe('outbox');
    expect(loadConfig({ ...valid, MWC_EMAIL: 'off' }).MWC_EMAIL).toBe('off');
  });

  it('keeps a From and an SMTP address, and refuses smtp until it is built, never echoing the address', () => {
    const smtp = 'smtps://mailer:s3cr3t-pass@smtp.example.com:465';
    const config = loadConfig({ ...valid, MWC_EMAIL_FROM: 'Team <team@example.com>', MWC_SMTP_URL: smtp });
    expect(config).toMatchObject({ MWC_EMAIL_FROM: 'Team <team@example.com>', MWC_SMTP_URL: smtp });
    const refused = () => loadConfig({ ...valid, MWC_EMAIL: 'smtp', MWC_SMTP_URL: smtp });
    expect(refused).toThrow(/MWC_EMAIL: smtp is not built yet/);
    try {
      refused();
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cr3t');
    }
    expect(() => loadConfig({ ...valid, MWC_SMTP_URL: 'http://smtp.example.com' })).toThrow(/MWC_SMTP_URL/);
    expect(() => loadConfig({ ...valid, MWC_EMAIL: 'mail' })).toThrow(/MWC_EMAIL/);
  });
});

describe('loadConfig MWC_MASTER_KEY', () => {
  it('is optional outside production and kept as given when it is the base64 of 32 bytes', () => {
    expect(loadConfig(valid).MWC_MASTER_KEY).toBeUndefined();
    expect(loadConfig({ ...valid, NODE_ENV: 'test', MWC_MASTER_KEY: '' }).MWC_MASTER_KEY).toBeUndefined();
    expect(loadConfig({ ...valid, MWC_MASTER_KEY: MASTER_KEY }).MWC_MASTER_KEY).toBe(MASTER_KEY);
  });

  it('refuses to start production without one, naming the variable', () => {
    const failure = () => loadConfig({ ...valid, NODE_ENV: 'production' });
    expect(failure).toThrow(ConfigError);
    expect(failure).toThrow(/MWC_MASTER_KEY: required in production/);
    expect(loadConfig({ ...valid, ...PRODUCTION }).MWC_MASTER_KEY).toBe(MASTER_KEY);
  });

  it('refuses a value that is not the base64 of 32 bytes, and never echoes it', () => {
    const short = randomBytes(16).toString('base64');
    const long = randomBytes(33).toString('base64');
    for (const bad of [short, long, MASTER_KEY.slice(0, -1), `${MASTER_KEY} `, 'not a key at all']) {
      try {
        loadConfig({ ...valid, MWC_MASTER_KEY: bad });
        expect.unreachable(`accepted ${bad.length} characters`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as Error).message).toMatch(/MWC_MASTER_KEY: must be the base64 of 32 bytes/);
        expect((error as Error).message).not.toContain(bad.trim());
      }
    }
  });

  it('decodes a well-formed key to its 32 bytes and nothing else', () => {
    const bytes = randomBytes(32);
    expect(decodeMasterKey(bytes.toString('base64'))).toEqual(new Uint8Array(bytes));
    expect(decodeMasterKey(bytes.toString('base64url'))).toBeUndefined();
    expect(decodeMasterKey('')).toBeUndefined();
  });
});

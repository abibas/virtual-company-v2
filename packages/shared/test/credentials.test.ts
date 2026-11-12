import { describe, expect, it } from 'vitest';
import {
  ACCESS_PROFILE_NAME,
  AI_PROVIDERS,
  ATLASSIAN_SITE,
  ATLASSIAN_TOKEN_PAGE,
  atlassianSite,
  CREDENTIAL_LABEL,
  CREDENTIAL_PURPOSE,
  DEFAULT_GATEWAY_PATHS,
  fitsGateway,
  fitsProvider,
  GATEWAY_HEADERS,
  GATEWAY_KINDS,
  GATEWAY_PATH_MAX,
  GATEWAY_ROUTES,
  GITHUB_TOKEN_PREFIXES,
  gatewayAddressOf,
  gatewayPathsOf,
  gatewayRouteOf,
  HARNESS_PROVIDER,
  isAiProvider,
  isToolKind,
  isToolProvider,
  joinGatewayPath,
  PASTED_CREDENTIAL_KINDS,
  PROFILE_PROVIDERS,
  PROVIDER_KINDS,
  profileFitsHarness,
  SECRET_MAX,
  SECRET_PREFIXES,
  TOOL_CREDENTIAL_KINDS,
  TOOL_PROVIDER_OF,
  TOOL_PROVIDERS,
} from '../src/credentials.ts';
import { AiProvider, CredentialKind, Harness, ProfileProvider } from '../src/enums.ts';

describe('the credential store contract', () => {
  it('holds the limits the credentials and credential_uses CHECKs hold', () => {
    expect(CREDENTIAL_LABEL).toEqual({ min: 1, max: 80 });
    expect(CREDENTIAL_PURPOSE).toEqual({ min: 1, max: 80 });
    expect(GATEWAY_HEADERS).toEqual({ min: 0, max: 20 });
    expect(SECRET_MAX).toBe(4096);
  });

  it('pastes four kinds; the two logins come from the sign-in helper', () => {
    expect(PASTED_CREDENTIAL_KINDS).toEqual([
      'claude_setup_token',
      'anthropic_api_key',
      'openai_api_key',
      'gateway',
    ]);
    const pasted: readonly string[] = PASTED_CREDENTIAL_KINDS;
    const signedIn = CredentialKind.options.filter((kind) => !pasted.includes(kind) && !isToolKind(kind));
    expect(signedIn).toEqual(['claude_oauth', 'codex_oauth']);
  });

  it('names the start of each pasted token and key', () => {
    expect(SECRET_PREFIXES).toEqual({
      claude_setup_token: 'sk-ant-oat01-',
      anthropic_api_key: 'sk-ant-api',
      openai_api_key: 'sk-',
    });
  });

  it('names an access profile in 1 to 80 characters', () => {
    expect(ACCESS_PROFILE_NAME).toEqual({ min: 1, max: 80 });
  });

  it('gives every kind to exactly one part of a profile: a provider’s subscription or sign-in, or its gateway', () => {
    expect(PROFILE_PROVIDERS).toEqual(ProfileProvider.options);
    expect(PROFILE_PROVIDERS).toEqual(Object.keys(PROVIDER_KINDS));
    for (const kind of CredentialKind.options) {
      const fits = [
        ...PROFILE_PROVIDERS.filter((provider) => fitsProvider(provider, kind)),
        fitsGateway(kind),
      ];
      expect(fits.filter(Boolean), kind).toHaveLength(1);
    }
    expect(fitsProvider('github', 'github_oauth')).toBe(true);
    expect(fitsProvider('github', 'github_token')).toBe(true);
    expect(fitsProvider('atlassian', 'atlassian_api_token')).toBe(true);
    expect(fitsProvider('github', 'atlassian_api_token')).toBe(false);
    expect(fitsProvider('github', 'claude_oauth')).toBe(false);
    expect(fitsProvider('atlassian', 'gateway')).toBe(false);
    expect(GATEWAY_KINDS).toEqual(['gateway']);
    expect(fitsProvider('claude', 'claude_oauth')).toBe(true);
    expect(fitsProvider('claude', 'claude_setup_token')).toBe(true);
    expect(fitsProvider('claude', 'anthropic_api_key')).toBe(true);
    expect(fitsProvider('openai', 'codex_oauth')).toBe(true);
    expect(fitsProvider('openai', 'openai_api_key')).toBe(true);
    expect(fitsProvider('claude', 'openai_api_key')).toBe(false);
    expect(fitsProvider('openai', 'claude_oauth')).toBe(false);
    expect(fitsProvider('openai', 'gateway')).toBe(false);
    expect(fitsGateway('gateway')).toBe(true);
    expect(fitsGateway('claude_oauth')).toBe(false);
  });

  it('tells the AI providers from the tools', () => {
    expect(AI_PROVIDERS).toEqual(AiProvider.options);
    expect([...AI_PROVIDERS, ...TOOL_PROVIDERS]).toEqual(PROFILE_PROVIDERS);
    expect(PROFILE_PROVIDERS.filter(isAiProvider)).toEqual(['claude', 'openai']);
    expect(PROFILE_PROVIDERS.filter(isToolProvider)).toEqual(['github', 'atlassian']);
  });

  it('runs each harness on profiles of one provider', () => {
    expect(HARNESS_PROVIDER).toEqual({ claude_code: 'claude', codex: 'openai' });
    for (const harness of Harness.options) {
      expect(PROFILE_PROVIDERS.filter((provider) => profileFitsHarness(provider, harness))).toEqual([
        HARNESS_PROVIDER[harness],
      ]);
    }
  });
});

const MEMORY = 'http://127.0.0.1:8300';

describe('a universal gateway', () => {
  it('reaches it by three routes, each with its default path', () => {
    expect(GATEWAY_ROUTES).toEqual(['claude', 'codexChatgpt', 'codexApiKey']);
    expect(DEFAULT_GATEWAY_PATHS).toEqual({
      claude: '',
      codexChatgpt: '/backend-api/codex',
      codexApiKey: '/v1',
    });
    expect(GATEWAY_PATH_MAX).toBe(512);
  });

  it('takes the route of the harness and, for Codex, of its credential', () => {
    expect(gatewayRouteOf('claude_code', 'claude_oauth')).toBe('claude');
    expect(gatewayRouteOf('claude_code', 'anthropic_api_key')).toBe('claude');
    expect(gatewayRouteOf('codex', 'codex_oauth')).toBe('codexChatgpt');
    expect(gatewayRouteOf('codex', 'openai_api_key')).toBe('codexApiKey');
  });

  it("reads a gateway's own paths, the defaults for any it leaves out or names wrongly, and ignores an old provider", () => {
    expect(gatewayPathsOf({ baseUrl: MEMORY })).toEqual(DEFAULT_GATEWAY_PATHS);
    expect(gatewayPathsOf({ baseUrl: MEMORY, provider: 'openai', paths: null })).toEqual(
      DEFAULT_GATEWAY_PATHS,
    );
    expect(gatewayPathsOf({ paths: 'nope' })).toEqual(DEFAULT_GATEWAY_PATHS);
    expect(gatewayPathsOf({ paths: { claude: '/anthropic', codexApiKey: 7 } })).toEqual({
      ...DEFAULT_GATEWAY_PATHS,
      claude: '/anthropic',
    });
    expect(gatewayPathsOf({ paths: { codexChatgpt: '' } })).toEqual({
      ...DEFAULT_GATEWAY_PATHS,
      codexChatgpt: '',
    });
  });

  it('joins an address and a path without double or trailing slashes', () => {
    expect(joinGatewayPath(MEMORY, '')).toBe(MEMORY);
    expect(joinGatewayPath(`${MEMORY}/`, '')).toBe(MEMORY);
    expect(joinGatewayPath(MEMORY, '/')).toBe(MEMORY);
    expect(joinGatewayPath(`${MEMORY}/`, '/v1')).toBe(`${MEMORY}/v1`);
    expect(joinGatewayPath(`${MEMORY}//`, '//v1/')).toBe(`${MEMORY}/v1`);
    expect(joinGatewayPath(MEMORY, 'backend-api/codex')).toBe(`${MEMORY}/backend-api/codex`);
    expect(joinGatewayPath(' https://gw.test/anthropic/ ', ' /v1 ')).toBe('https://gw.test/anthropic/v1');
  });

  it('keeps an address that already ends with the path', () => {
    expect(joinGatewayPath(`${MEMORY}/backend-api/codex`, '/backend-api/codex')).toBe(
      `${MEMORY}/backend-api/codex`,
    );
    expect(joinGatewayPath(`${MEMORY}/backend-api/codex/`, '/backend-api/codex')).toBe(
      `${MEMORY}/backend-api/codex`,
    );
    expect(joinGatewayPath(`${MEMORY}/v1`, '/v1')).toBe(`${MEMORY}/v1`);
    expect(joinGatewayPath('https://gw.test/xv1', '/v1')).toBe('https://gw.test/xv1/v1');
  });

  it("derives each route's address of a gateway, with default and custom paths", () => {
    const memory = { baseUrl: MEMORY };
    expect(gatewayAddressOf(memory, 'claude')).toBe(MEMORY);
    expect(gatewayAddressOf(memory, 'codexChatgpt')).toBe(`${MEMORY}/backend-api/codex`);
    expect(gatewayAddressOf(memory, 'codexApiKey')).toBe(`${MEMORY}/v1`);
    const custom = {
      baseUrl: 'https://gw.test/',
      paths: { claude: '/anthropic', codexChatgpt: '/', codexApiKey: '/openai/v1' },
    };
    expect(gatewayAddressOf(custom, 'claude')).toBe('https://gw.test/anthropic');
    expect(gatewayAddressOf(custom, 'codexChatgpt')).toBe('https://gw.test');
    expect(gatewayAddressOf(custom, 'codexApiKey')).toBe('https://gw.test/openai/v1');
    expect(gatewayAddressOf({}, 'claude')).toBeUndefined();
    expect(gatewayAddressOf({ baseUrl: ' ' }, 'claude')).toBeUndefined();
    expect(gatewayAddressOf({ baseUrl: 8300 }, 'claude')).toBeUndefined();
  });
});

describe('the tool sign-ins', () => {
  it('are GitHub’s two and Atlassian’s, each for its own tool’s profile, and never an AI profile’s', () => {
    expect(TOOL_CREDENTIAL_KINDS).toEqual(['github_oauth', 'github_token', 'atlassian_api_token']);
    expect(TOOL_PROVIDERS).toEqual(['github', 'atlassian']);
    expect(TOOL_PROVIDER_OF).toEqual({
      github_oauth: 'github',
      github_token: 'github',
      atlassian_api_token: 'atlassian',
    });
    expect(CredentialKind.options.filter(isToolKind)).toEqual([...TOOL_CREDENTIAL_KINDS]);
    for (const kind of TOOL_CREDENTIAL_KINDS) {
      expect(AI_PROVIDERS.some((provider) => fitsProvider(provider, kind))).toBe(false);
      expect(PROFILE_PROVIDERS.filter((provider) => fitsProvider(provider, kind))).toEqual([
        TOOL_PROVIDER_OF[kind],
      ]);
      expect(fitsGateway(kind)).toBe(false);
      expect(PASTED_CREDENTIAL_KINDS as readonly string[]).not.toContain(kind);
    }
    expect(GITHUB_TOKEN_PREFIXES).toEqual(['ghp_', 'github_pat_']);
    expect(ATLASSIAN_TOKEN_PAGE).toBe('https://id.atlassian.com/manage-profile/security/api-tokens');
  });

  it.each([
    ['airia', 'airia.atlassian.net'],
    ['airia.atlassian.net', 'airia.atlassian.net'],
    ['  https://Airia.Atlassian.net/jira/software/projects?x=1  ', 'airia.atlassian.net'],
    ['http://my-team.atlassian.net/', 'my-team.atlassian.net'],
    ['airia.atlassian.net.', 'airia.atlassian.net'],
  ])('reads the site %j as %s', (input, site) => {
    expect(atlassianSite(input)).toBe(site);
    expect(ATLASSIAN_SITE.test(site)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'airia.example.com',
    'evil.com/airia.atlassian.net',
    '-airia.atlassian.net',
    'air ia',
    'airia.atlassian.net.evil.com',
    `${'a'.repeat(64)}.atlassian.net`,
  ])('refuses %j as a site', (input) => {
    expect(atlassianSite(input)).toBeUndefined();
  });
});

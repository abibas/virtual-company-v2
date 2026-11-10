import { describe, expect, it } from 'vitest';
import {
  DIRECT_PROVIDER_ID,
  GATEWAY_HEADER_ENV_PREFIX,
  GATEWAY_PROVIDER_ID,
  GATEWAY_PROVIDER_NAME,
  gatewayEnv,
  providerArgs,
} from '../src/gateway.ts';

const CHATGPT = { baseUrl: 'http://127.0.0.1:8300/backend-api/codex', headers: {} };
const WITH_HEADERS = {
  baseUrl: 'http://127.0.0.1:8300/v1',
  headers: { 'x-memory-agent': 'slop-secret', 'X-Api-Key': 'gw-secret' },
};

/** The overrides every gateway gets: the custom provider, its name, its address and the Responses API. */
const base = (url: string) => [
  '-c',
  'model_provider="mwc_gateway"',
  '-c',
  'model_providers.mwc_gateway.name="Most Wanted gateway"',
  '-c',
  `model_providers.mwc_gateway.base_url="${url}"`,
  '-c',
  'model_providers.mwc_gateway.wire_api="responses"',
];

describe('providerArgs', () => {
  it('sends a ChatGPT login through the gateway’s custom provider with OpenAI auth', () => {
    expect([GATEWAY_PROVIDER_ID, GATEWAY_PROVIDER_NAME]).toEqual(['mwc_gateway', 'Most Wanted gateway']);
    expect(providerArgs(CHATGPT, undefined)).toEqual([
      ...base('http://127.0.0.1:8300/backend-api/codex'),
      '-c',
      'model_providers.mwc_gateway.requires_openai_auth=true',
    ]);
  });

  it('sends an API key from the variable it is in, and the headers by variable name, never their values', () => {
    const args = providerArgs(WITH_HEADERS, 'CODEX_API_KEY');
    expect(args).toEqual([
      ...base('http://127.0.0.1:8300/v1'),
      '-c',
      'model_providers.mwc_gateway.env_key="CODEX_API_KEY"',
      '-c',
      'model_providers.mwc_gateway.env_http_headers={ "x-memory-agent" = "MWC_GATEWAY_SECRET_HEADER_1", "X-Api-Key" = "MWC_GATEWAY_SECRET_HEADER_2" }',
    ]);
    expect(args.join(' ')).not.toMatch(/slop-secret|gw-secret/);
    expect(args).not.toContain('model_providers.mwc_gateway.requires_openai_auth=true');
  });

  it('without a gateway, names Codex’s built-in OpenAI provider', () => {
    expect(DIRECT_PROVIDER_ID).toBe('openai');
    expect(providerArgs(null, undefined)).toEqual(['-c', 'model_provider="openai"']);
    expect(providerArgs(null, 'CODEX_API_KEY')).toEqual(['-c', 'model_provider="openai"']);
  });
});

describe('gatewayEnv', () => {
  it('puts each header’s value in the variable providerArgs names, in the headers’ order', () => {
    expect(GATEWAY_HEADER_ENV_PREFIX).toBe('MWC_GATEWAY_SECRET_HEADER_');
    expect(gatewayEnv(WITH_HEADERS)).toEqual({
      MWC_GATEWAY_SECRET_HEADER_1: 'slop-secret',
      MWC_GATEWAY_SECRET_HEADER_2: 'gw-secret',
    });
    expect(gatewayEnv(CHATGPT)).toEqual({});
    expect(gatewayEnv(null)).toEqual({});
  });
});

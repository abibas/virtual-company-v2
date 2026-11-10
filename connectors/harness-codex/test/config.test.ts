import { describe, expect, it } from 'vitest';
import { configArg, configFlagArg, configListArg, configTableArg } from '../src/config.ts';

describe('the config overrides', () => {
  it('write a TOML string, array of strings, boolean and inline table of strings', () => {
    expect(configArg('model_provider', 'mwc_gateway')).toEqual(['-c', 'model_provider="mwc_gateway"']);
    expect(configListArg('k', ['a', 'b'])).toEqual(['-c', 'k=["a","b"]']);
    expect(configFlagArg('p.requires_openai_auth', true)).toEqual(['-c', 'p.requires_openai_auth=true']);
    expect(configFlagArg('p.flag', false)).toEqual(['-c', 'p.flag=false']);
    expect(configTableArg('p.env_http_headers', { 'x-api-key': 'V_1', "x-team's": 'V_2' })).toEqual([
      '-c',
      `p.env_http_headers={ "x-api-key" = "V_1", "x-team's" = "V_2" }`,
    ]);
    expect(configTableArg('p.t', {})).toEqual(['-c', 'p.t={  }']);
  });
});

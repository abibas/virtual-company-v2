import type { HarnessGateway } from '@mwc/shared/harness';
import { configArg, configFlagArg, configTableArg } from './config.ts';

/**
 * The access profile's gateway as Codex takes it (docs/harness.md, "Codex"): a custom model provider given as config
 * overrides, so it wins over any `config.toml` in Codex's home folder. Verified against Codex 0.162.1's own config
 * loading (each key below is refused there when given a value of the wrong type; `wire_api` takes `responses` only).
 *
 * - With a gateway: `model_provider="mwc_gateway"` and the provider's `name`, `base_url` and `wire_api="responses"`;
 *   a ChatGPT login (and an API key in the TUI, read from `auth.json`) authenticates with `requires_openai_auth=true`,
 *   an API key in `codex exec` with `env_key=<the variable the key is in>`. Its headers go as `env_http_headers`, each
 *   header naming a variable `MWC_GATEWAY_SECRET_HEADER_<n>` whose value is in the process's environment: never on the
 *   command line, where every user of the machine would see them.
 * - Without one: `model_provider="openai"`, Codex's built-in provider, so a `config.toml` in a placement's config folder
 *   cannot send the turn elsewhere.
 */

/** The custom provider's id and name. */
export const GATEWAY_PROVIDER_ID = 'mwc_gateway';
export const GATEWAY_PROVIDER_NAME = 'Most Wanted gateway';

/** Codex's built-in provider: OpenAI directly. */
export const DIRECT_PROVIDER_ID = 'openai';

/**
 * The variables that carry the gateway's header values: `MWC_GATEWAY_SECRET_HEADER_1`, `_2`… in the headers' order. The
 * name holds SECRET so Codex's default shell environment filter keeps them out of the commands the agent runs.
 */
export const GATEWAY_HEADER_ENV_PREFIX = 'MWC_GATEWAY_SECRET_HEADER_';

/** Each header's name with the variable that carries its value. */
const headerVariables = (headers: HarnessGateway['headers']): Array<readonly [string, string, string]> =>
  Object.entries(headers).map(([name, value], index) => [
    name,
    `${GATEWAY_HEADER_ENV_PREFIX}${index + 1}`,
    value,
  ]);

/**
 * The provider overrides: the gateway's custom provider (authenticated by `keyEnv`, the variable an API key is in, or
 * else by Codex's own login file), or Codex's built-in OpenAI provider.
 */
export function providerArgs(gateway: HarnessGateway | null, keyEnv: string | undefined): string[] {
  if (gateway === null) return configArg('model_provider', DIRECT_PROVIDER_ID);
  const provider = `model_providers.${GATEWAY_PROVIDER_ID}`;
  const headers = headerVariables(gateway.headers);
  return [
    ...configArg('model_provider', GATEWAY_PROVIDER_ID),
    ...configArg(`${provider}.name`, GATEWAY_PROVIDER_NAME),
    ...configArg(`${provider}.base_url`, gateway.baseUrl),
    ...configArg(`${provider}.wire_api`, 'responses'),
    ...(keyEnv === undefined
      ? configFlagArg(`${provider}.requires_openai_auth`, true)
      : configArg(`${provider}.env_key`, keyEnv)),
    ...(headers.length === 0
      ? []
      : configTableArg(
          `${provider}.env_http_headers`,
          Object.fromEntries(headers.map(([name, variable]) => [name, variable])),
        )),
  ];
}

/** The gateway's header values, each in its variable (`providerArgs` names them); nothing without a gateway. */
export function gatewayEnv(gateway: HarnessGateway | null): Record<string, string> {
  if (gateway === null) return {};
  return Object.fromEntries(headerVariables(gateway.headers).map(([, variable, value]) => [variable, value]));
}

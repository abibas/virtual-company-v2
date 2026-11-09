import { describe, expect, it } from 'vitest';
import { processEnv } from '../../src/turns/env.ts';

describe("a harness process's environment", () => {
  it("is the runner's less MWC_* and what the driver unsets, plus the driver's own and the extra", () => {
    const own = {
      PATH: '/usr/bin',
      HOME: '/home/runner',
      MWC_RUNNER_CONFIG: '/etc/runner.json',
      MWC_ENROLL_TOKEN: 'mwc_et_x',
      ANTHROPIC_API_KEY: 'stray',
      UNSET: undefined,
      CODEX_HOME: '/home/runner/.codex',
    };
    expect(
      processEnv(
        own,
        { command: 'claude', env: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, unsetEnv: ['ANTHROPIC_API_KEY'] },
        { CODEX_HOME: '/s' },
      ),
    ).toEqual({ PATH: '/usr/bin', HOME: '/home/runner', CLAUDE_CODE_OAUTH_TOKEN: 't', CODEX_HOME: '/s' });
    expect(processEnv({ A: '1' }, { command: 'codex', env: {}, unsetEnv: [] })).toEqual({ A: '1' });
  });

  it('puts the folder of a CLI started by its full path first on the PATH, once, so its helpers resolve', () => {
    const spec = { command: '/home/u/.nvm/versions/node/v24.1.0/bin/claude', env: {}, unsetEnv: [] };
    expect(processEnv({ PATH: '/usr/bin:/home/u/.nvm/versions/node/v24.1.0/bin' }, spec)).toEqual({
      PATH: '/home/u/.nvm/versions/node/v24.1.0/bin:/usr/bin',
    });
    expect(processEnv({}, spec)).toEqual({ PATH: '/home/u/.nvm/versions/node/v24.1.0/bin' });
  });
});

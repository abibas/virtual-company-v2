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
        { env: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, unsetEnv: ['ANTHROPIC_API_KEY'] },
        { CODEX_HOME: '/s' },
      ),
    ).toEqual({ PATH: '/usr/bin', HOME: '/home/runner', CLAUDE_CODE_OAUTH_TOKEN: 't', CODEX_HOME: '/s' });
    expect(processEnv({ A: '1' }, { env: {}, unsetEnv: [] })).toEqual({ A: '1' });
  });
});

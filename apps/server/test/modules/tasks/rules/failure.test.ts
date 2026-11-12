import { describe, expect, it } from 'vitest';
import { failureWords, readableReason } from '../../../../src/modules/tasks/rules/failure.ts';

describe('why a step’s turn failed, in words', () => {
  it('names the machine for each code the runner and the server end a turn with', () => {
    const box = 'Airia devbox';
    expect(failureWords('busy', box)).toBe('Airia devbox had no free slot');
    expect(failureWords('unsupported', box)).toBe('The runner on Airia devbox cannot run this harness');
    expect(failureWords('home_missing', box)).toBe(
      "The agent's folder is not on Airia devbox: check where it runs",
    );
    expect(failureWords('invalid_spec: model', box)).toBe("The runner refused the turn's settings (model)");
    expect(failureWords('spawn_failed: ENOENT: codex', box)).toBe(
      'The harness did not start on Airia devbox (ENOENT: codex)',
    );
    expect(failureWords('spawn_failed', box)).toBe('The harness did not start on Airia devbox');
    expect(failureWords('stopped', box)).toBe('The turn was stopped');
    expect(failureWords('runner_stopping', box)).toBe('The runner on Airia devbox stopped');
    expect(failureWords('process_lost', box)).toBe(
      "The turn's process on Airia devbox ended without its result",
    );
    expect(failureWords('machine_disconnected', box)).toBe('Airia devbox disconnected during the turn');
    expect(
      failureWords(
        'machine_disconnected: Airia devbox was unreachable for 30 minutes: the turn stopped.',
        box,
      ),
    ).toBe('Airia devbox was unreachable for 30 minutes: the turn stopped.');
    expect(failureWords('server_restarted', box)).toBe('The server restarted during the turn');
    expect(failureWords('machine_offline', box)).toBe('Airia devbox went offline before the turn started');
  });

  it('says "the machine" without a name, and passes words through as they are', () => {
    expect(failureWords('busy', null)).toBe('The machine had no free slot');
    expect(failureWords('runner_stopping', null)).toBe('The runner on the machine stopped');
    expect(failureWords('Airia devbox did not connect within 10 minutes', 'Airia devbox')).toBe(
      'Airia devbox did not connect within 10 minutes',
    );
    expect(failureWords('nothing_known', 'Box')).toBe('nothing_known');
    expect(readableReason('busy')).toBe('The machine had no free slot');
    expect(readableReason('The repo is missing')).toBe('The repo is missing');
    expect(readableReason(null)).toBeNull();
  });
});

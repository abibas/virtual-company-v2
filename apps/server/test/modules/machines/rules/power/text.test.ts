import { MachinePowerPolicy, type MachinePowerPolicyInput } from '@mwc/shared/machines';
import { describe, expect, it } from 'vitest';
import {
  alreadyText,
  daysText,
  hoursText,
  policyText,
} from '../../../../../src/modules/machines/rules/power/text.ts';

const policy = (input: MachinePowerPolicyInput = {}) => MachinePowerPolicy.parse(input);
const hours = (extra: MachinePowerPolicyInput = {}) => policy({ keepOn: { enabled: true }, ...extra });

describe('the policy in words', () => {
  it('names the days as ranges and lists', () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daysText([7, 6, 5, 4, 3, 2, 1])).toBe('every day');
    expect(daysText([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(daysText([6, 7])).toBe('Sat, Sun');
    expect(daysText([1, 2, 3, 5, 6, 7])).toBe('Mon–Wed, Fri–Sun');
  });

  it('says the hours and every switch', () => {
    expect(hoursText(policy())).toBe('Mon–Fri 09:00–19:00 Europe/Kyiv');
    expect(policyText(policy())).toBe(
      'Keep-on hours off; start when they begin: off; stop when they end: on; hold after a turn: 45 min; ' +
        'keep This Mac awake: on; start on work: off; start on a message: off',
    );
    expect(policyText(hours({ autoStartAtKeepOn: true, keepMacAwake: false }))).toMatch(
      /^Keep-on hours on \(Mon–Fri 09:00–19:00 Europe\/Kyiv\); start when they begin: on; .* keep This Mac awake: off;/,
    );
  });
});

describe('a start or a stop that found the box already there', () => {
  it('says so after its reason', () => {
    expect(alreadyText('Keep-on hours started (Mon–Fri 09:00–19:00 Europe/Kyiv)', 'start')).toBe(
      'Keep-on hours started (Mon–Fri 09:00–19:00 Europe/Kyiv): the box was already on',
    );
    expect(alreadyText('Stopped by hand', 'stop')).toBe('Stopped by hand: the box was already off');
  });
});

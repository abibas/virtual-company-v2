import { describe, expect, it } from 'vitest';
import { BOX_RULE_KEYS, boxRulesFromMetadata, DEFAULT_BOX_RULES } from '../src/rules.ts';

describe('boxRulesFromMetadata', () => {
  it('has the airia CLI’s defaults when the metadata says nothing', () => {
    expect(DEFAULT_BOX_RULES).toEqual({
      timezone: 'America/Chicago',
      idleShutdownMin: 45,
      idleOffhoursMin: 20,
      idleLoadThreshold: 0.5,
      workStartHour: 8,
      workEndHour: 19,
      nightlyStopHour: 20,
    });
    expect(boxRulesFromMetadata(undefined)).toEqual(DEFAULT_BOX_RULES);
    expect(boxRulesFromMetadata([])).toEqual(DEFAULT_BOX_RULES);
  });

  it('reads every rule from its key, ignoring the other metadata', () => {
    expect(
      boxRulesFromMetadata([
        { key: 'enable-oslogin', value: 'TRUE' },
        { key: 'startup-script', value: '#!/bin/bash\necho hi' },
        { key: 'devbox-tz', value: 'Europe/Kyiv' },
        { key: 'idle-shutdown-min', value: '60' },
        { key: 'idle-offhours-min', value: ' 15 ' },
        { key: 'idle-load-threshold', value: '1.25' },
        { key: 'work-start-hour', value: '0' },
        { key: 'work-end-hour', value: '23' },
        { key: 'nightly-stop-hour', value: '22' },
      ]),
    ).toEqual({
      timezone: 'Europe/Kyiv',
      idleShutdownMin: 60,
      idleOffhoursMin: 15,
      idleLoadThreshold: 1.25,
      workStartHour: 0,
      workEndHour: 23,
      nightlyStopHour: 22,
    });
    expect(Object.values(BOX_RULE_KEYS)).toHaveLength(7);
  });

  it('keeps the default of a rule whose value does not parse or is out of range', () => {
    expect(
      boxRulesFromMetadata([
        { key: 'devbox-tz', value: 'Mars/Olympus' },
        { key: 'idle-shutdown-min', value: '0' },
        { key: 'idle-offhours-min', value: '7.5' },
        { key: 'idle-load-threshold', value: '-1' },
        { key: 'work-start-hour', value: '24' },
        { key: 'work-end-hour', value: '' },
        { key: 'nightly-stop-hour', value: 'eight' },
      ]),
    ).toEqual(DEFAULT_BOX_RULES);
    expect(boxRulesFromMetadata([{ key: 'devbox-tz' }, { key: 'idle-shutdown-min' }])).toEqual(
      DEFAULT_BOX_RULES,
    );
  });
});

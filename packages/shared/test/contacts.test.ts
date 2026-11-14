import { describe, expect, it } from 'vitest';
import { CONTACT_INTERACTIONS, CONTACT_NAME_MAX, CONTACT_NOTE_MAX } from '../src/contacts.ts';
import { ContactSource } from '../src/enums.ts';

describe('contacts', () => {
  it('come from Slack, with a name of 120 characters, a note of 2000 and a window of 7 to 90 days', () => {
    expect(ContactSource.options).toEqual(['slack']);
    expect(CONTACT_NAME_MAX).toBe(120);
    expect(CONTACT_NOTE_MAX).toBe(2000);
    expect(CONTACT_INTERACTIONS).toEqual({ defaultDays: 7, maxDays: 90 });
  });
});

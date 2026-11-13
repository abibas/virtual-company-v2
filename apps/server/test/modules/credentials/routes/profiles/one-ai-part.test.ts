import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { addSubscription, auditRows, PROFILES } from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// One AI part per profile (since 2026-11-13, docs/subscriptions.md "Profiles"; Ihor: "EITHER 1 harness EITHER 2nd
// one... NOT BOTH"): a profile has a Claude part or an OpenAI part, or neither; a second one is 422 `one_ai_part`,
// writing nothing. Removing the one it has, or swapping them in one change, leaves room for the other.

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const as = (requestId?: string) => call(w, ihor.token, requestId);
let names = 0;
const post = (body: Record<string, unknown>) =>
  as()('POST', PROFILES, { name: `One AI ${++names}`, ...body });
const patch = (id: string, body: Record<string, unknown>, requestId?: string) =>
  as(requestId)('PATCH', `${PROFILES}/${id}`, body);
const made = async (body: Record<string, unknown>) => (await post(body)).body as AccessProfileView;
const oneAiPart = (message: string) => ({ status: 422, body: { error: { code: 'one_ai_part', message } } });

describe('one AI part per profile', () => {
  it('refuses a new profile with both', async () => {
    expect(await post({ parts: { claude: {}, openai: {} } })).toMatchObject(
      oneAiPart('A profile runs one AI: give it a Claude part or an OpenAI part, not both'),
    );
  });

  it('refuses adding the second, naming the one it has, and writes nothing', async () => {
    const claude = await made({ parts: { claude: {} } });
    expect(await patch(claude.id, { parts: { openai: {} } }, 'req-second')).toMatchObject(
      oneAiPart('This profile already has a Claude part; a profile runs one AI'),
    );
    const codex = await made({ parts: { openai: {} } });
    const sub = await addSubscription(w, keyring, ihor.userId, 'claude_setup_token');
    expect(
      await patch(codex.id, { name: 'Renamed', parts: { claude: { credentialId: sub.id } } }),
    ).toMatchObject(oneAiPart('This profile already has an OpenAI part; a profile runs one AI'));
    const updates = (await auditRows(w.t.db, 'access_profile', claude.id)).filter(
      (row) => row.action === 'update',
    );
    expect(updates).toEqual([]);
  });

  it('takes the other once the first is removed, or swapped in one change', async () => {
    const profile = await made({ parts: { claude: {}, github: {} } });
    expect(await patch(profile.id, { parts: { claude: null } })).toMatchObject({
      status: 200,
      body: { parts: { claude: null, openai: null, github: {} } },
    });
    expect(await patch(profile.id, { parts: { openai: {} } })).toMatchObject({
      status: 200,
      body: { parts: { claude: null, openai: {} } },
    });
    expect(await patch(profile.id, { parts: { openai: null, claude: {} } })).toMatchObject({
      status: 200,
      body: { parts: { claude: {}, openai: null } },
    });
  });

  it('keeps a profile with tool parts only', async () => {
    expect((await made({ parts: { github: {}, atlassian: {} } })).parts).toMatchObject({
      claude: null,
      openai: null,
      github: {},
      atlassian: {},
    });
  });
});

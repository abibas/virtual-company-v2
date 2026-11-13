import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../../src/modules/credentials/schemas/profiles.ts';
import { addUser, call, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { auditRows, PROFILES } from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// An AI part's permission mode (2026-11-13, docs/subscriptions.md "Mode"): Claude Code's five on a Claude part, Codex's
// three on an OpenAI part, Manual or Ask when a part is added without one; a mode of the other harness is a 400.

let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld();
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const as = (requestId?: string) => call(w, ihor.token, requestId);
let names = 0;
const post = (parts: Record<string, unknown>) => as()('POST', PROFILES, { name: `Mode ${++names}`, parts });
const patch = (id: string, parts: Record<string, unknown>, requestId?: string) =>
  as(requestId)('PATCH', `${PROFILES}/${id}`, { parts });

describe("a profile's mode", () => {
  it('starts each AI part on its default, Manual or Ask, and takes each of its own modes', async () => {
    expect((await post({ claude: {} })).body).toMatchObject({ parts: { claude: { mode: 'manual' } } });
    expect((await post({ openai: {} })).body).toMatchObject({ parts: { openai: { mode: 'ask' } } });
    for (const mode of ['manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']) {
      expect((await post({ claude: { mode } })).body).toMatchObject({ parts: { claude: { mode } } });
    }
    for (const mode of ['ask', 'auto', 'full']) {
      expect((await post({ openai: { mode } })).body).toMatchObject({ parts: { openai: { mode } } });
    }
  });

  it('changes it alone, audited; the same mode writes nothing', async () => {
    const created = (await post({ claude: { model: 'claude-opus-5-5' } })).body as AccessProfileView;
    const res = await patch(created.id, { claude: { mode: 'bypassPermissions' } }, 'req-mode-1');
    expect(res.status).toBe(200);
    expect((res.body as AccessProfileView).parts.claude).toMatchObject({
      model: 'claude-opus-5-5',
      mode: 'bypassPermissions',
    });
    expect((await patch(created.id, { claude: { mode: 'bypassPermissions' } }, 'req-mode-2')).status).toBe(
      200,
    );
    const changes = (await auditRows(w.t.db, 'access_profile', created.id))
      .filter((row) => row.action === 'update')
      .map((row) => [row.field, row.oldValue, row.newValue, row.requestId]);
    expect(changes).toEqual([['claudeMode', 'manual', 'bypassPermissions', 'req-mode-1']]);
  });

  it('refuses a mode of the other harness, or none at all, as a request that does not fit (400)', async () => {
    for (const parts of [
      { claude: { mode: 'full' } },
      { openai: { mode: 'plan' } },
      { openai: { mode: 'acceptEdits' } },
      { claude: { mode: null } },
      { claude: { mode: 'default' } },
    ]) {
      expect(await post(parts)).toMatchObject({ status: 400, body: { error: { code: 'invalid_request' } } });
    }
  });

  it('empties the mode with its part, and a swap starts the new part on its default', async () => {
    const created = (await post({ claude: { mode: 'plan' } })).body as AccessProfileView;
    const swapped = await patch(created.id, { claude: null, openai: {} });
    expect((swapped.body as AccessProfileView).parts).toMatchObject({
      claude: null,
      openai: { mode: 'ask' },
    });
  });
});

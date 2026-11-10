import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../../src/modules/credentials/schemas/profiles.ts';
import { addUser, call, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { auditRows, PROFILES } from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// An access profile's model and effort (since 2026-11-10, docs/subscriptions.md "Model and effort"): a model of its
// provider (the catalogue's or another id that looks like one), an effort its model takes, each null for the provider's
// default; a model of the other provider and an effort the model does not take are 422s.

let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld();
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const as = (requestId?: string) => call(w, ihor.token, requestId);
let names = 0;
const post = (body: Record<string, unknown>) => as()('POST', PROFILES, { name: `Model ${++names}`, ...body });
const patch = (id: string, body: Record<string, unknown>, requestId?: string) =>
  as(requestId)('PATCH', `${PROFILES}/${id}`, body);
const refusal = (code: string) => ({ status: 422, body: { error: { code } } });

describe("a profile's model and effort", () => {
  it("takes each provider's catalogue models at their levels, a typed-in id, and the defaults", async () => {
    for (const [provider, model, effort] of [
      ['claude', 'claude-fable-5-1', 'max'],
      ['openai', 'gpt-6.1-sol', 'ultra'],
      ['openai', 'gpt-5.5', 'xhigh'],
      ['openai', 'gpt-7-preview', 'ultra'],
      ['claude', 'claude-opus-5-5[1m]', 'low'],
      ['openai', null, 'ultra'],
    ] as const) {
      const res = await post({ provider, model, effort });
      expect(res.status, `${provider} ${model} ${effort}`).toBe(201);
      expect(res.body).toMatchObject({ provider, model, effort });
    }
    expect((await post({ provider: 'claude' })).body).toMatchObject({ model: null, effort: null });
  });

  it('refuses a model of the other provider, and an effort its model or provider does not take', async () => {
    expect(await post({ provider: 'openai', model: 'claude-opus-5-5' })).toMatchObject(
      refusal('model_provider_mismatch'),
    );
    expect(await post({ provider: 'claude', model: 'gpt-6-sol' })).toMatchObject(
      refusal('model_provider_mismatch'),
    );
    expect(await post({ provider: 'claude', effort: 'ultra' })).toMatchObject(refusal('effort_unsupported'));
    expect(await post({ provider: 'openai', model: 'gpt-6-luna', effort: 'ultra' })).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'effort_unsupported',
          message: 'GPT-6 Luna takes the efforts low, medium, high, xhigh, max, not ultra',
        },
      },
    });
  });

  it('refuses a model id that does not look like one, and an effort no provider has (400)', async () => {
    for (const body of [
      { provider: 'claude', model: '' },
      { provider: 'claude', model: 'two words' },
      { provider: 'claude', model: '--model' },
      { provider: 'claude', model: 'm'.repeat(101) },
      { provider: 'openai', effort: 'minimal' },
      { provider: 'claude', effort: 'turbo' },
    ]) {
      expect(await post(body), JSON.stringify(body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
  });

  it('changes the model and effort, checks them against what the profile runs after, and audits each', async () => {
    const created = (await post({ provider: 'openai', model: 'gpt-6.1-sol', effort: 'ultra' }))
      .body as AccessProfileView;
    // GPT-5.5 takes no ultra: the stored effort refuses the move until the change gives one it takes.
    expect(await patch(created.id, { model: 'gpt-5.5' })).toMatchObject(refusal('effort_unsupported'));
    const moved = await patch(created.id, { model: 'gpt-5.5', effort: 'high' }, 'req-model-1');
    expect(moved).toMatchObject({ status: 200, body: { model: 'gpt-5.5', effort: 'high' } });
    const reset = await patch(created.id, { model: null, effort: null }, 'req-model-2');
    expect(reset).toMatchObject({ status: 200, body: { model: null, effort: null } });
    expect(await patch(created.id, { model: 'claude-haiku-5-5' })).toMatchObject(
      refusal('model_provider_mismatch'),
    );
    // A rename alone does not check what the profile runs.
    expect((await patch(created.id, { name: 'Renamed model' })).status).toBe(200);
    const updates = (await auditRows(w.t.db, 'access_profile', created.id)).filter(
      (row) => row.action === 'update',
    );
    expect(updates.map((row) => [row.requestId, row.field, row.oldValue, row.newValue])).toEqual([
      ['req-model-1', 'effort', 'ultra', 'high'],
      ['req-model-1', 'model', 'gpt-6.1-sol', 'gpt-5.5'],
      ['req-model-2', 'effort', 'high', null],
      ['req-model-2', 'model', 'gpt-5.5', null],
      [expect.any(String), 'name', expect.any(String), 'Renamed model'],
    ]);
  });
});

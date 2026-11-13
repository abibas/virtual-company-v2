import { accessProfiles, owned } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ChatsWorld,
  chatsWorld,
  ended,
  endTurn,
  type Scene,
  scene,
  startedTurn,
} from '../../../../fixtures/chats/world.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { addSubscription, seedProfile } from '../../../../fixtures/org.ts';

// What a turn runs (since 2026-11-10, docs/subscriptions.md "Model and effort"): the model and effort of the access
// profile it runs on, the chat's own when it has one, else the agent's; none for the provider's default, and the
// harness's own default for Codex's old marker or a model the harness cannot take (`turnModel`, `turnEffort`).

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
  w.provider.reset();
});
afterAll(() => w.close());

/** The runner ends the turn, and the server has closed it. */
async function finish(s: Scene, turnId: string) {
  endTurn(s.runner as FakeRunner, turnId);
  await ended(w.t.db, turnId);
}

/** Changes what a scene's profile's OpenAI part runs straight in the table (no rules checked). */
async function openaiRuns(s: Scene, set: { openaiModel?: string | null; openaiEffort?: 'max' | null }) {
  await owned(w.t.db, s.company.owner.userId).update(
    accessProfiles,
    set,
    eq(accessProfiles.id, s.profile.id),
  );
}

describe("a turn's model and effort", () => {
  it("are the agent's profile's", async () => {
    const s = await scene(w, { harness: 'codex', model: 'gpt-6-astra', effort: 'ultra' });
    const { spec } = await startedTurn(w, s);
    expect([spec.harness, spec.model, spec.effort]).toEqual(['codex', 'gpt-6-astra', 'ultra']);
  });

  it("are the chat's own profile's when it has one, the agent's again without it", async () => {
    const s = await scene(w, { model: 'claude-opus-5-5', effort: 'low' });
    const owner = s.company.owner;
    const credential = await addSubscription(w, w.keyring, owner.userId, 'claude_setup_token');
    const own = await seedProfile(w.t.db, owner.userId, {
      credentialId: credential.id,
      model: 'claude-sonnet-5-5',
      effort: 'max',
    });
    const chatPath = `/api/companies/${s.company.companyId}/chats/${s.chat.id}`;
    expect((await as(w, owner)('PATCH', chatPath, { profileId: own.id })).status).toBe(200);
    const first = await startedTurn(w, s, 'on the chat’s profile');
    expect([first.spec.model, first.spec.effort]).toEqual(['claude-sonnet-5-5', 'max']);
    await finish(s, first.turnId);
    expect((await as(w, owner)('PATCH', chatPath, { profileId: null })).status).toBe(200);
    const second = await startedTurn(w, s, 'on the agent’s profile');
    expect([second.spec.model, second.spec.effort]).toEqual(['claude-opus-5-5', 'low']);
  });

  it("leave the harness its own default for the provider's defaults and for what it cannot take", async () => {
    const s = await scene(w, { harness: 'codex', model: null, effort: null });
    const defaults = await startedTurn(w, s);
    expect(defaults.spec.model).toBeNull();
    expect(defaults.spec).not.toHaveProperty('effort');
    await finish(s, defaults.turnId);
    await openaiRuns(s, { openaiModel: 'codex-default', openaiEffort: 'max' });
    const marker = await startedTurn(w, s, 'the old marker');
    expect([marker.spec.model, marker.spec.effort]).toEqual([null, 'max']);
    const claude = await scene(w, { model: 'claude-haiku-5-5', effort: 'ultra' });
    const refused = await startedTurn(w, claude);
    expect([refused.spec.model, refused.spec.effort]).toEqual(['claude-haiku-5-5', undefined]);
  });
});

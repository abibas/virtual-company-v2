import { describe, expect, it } from 'vitest';
import {
  type BranchMarker,
  branchFacts,
  branchPoint,
  branchTitle,
  isBranchable,
  LATEST_ONLY,
} from '../../../../src/modules/chats/rules/branch.ts';

const session = (
  turnId: string,
  sessionId: string,
  kind: BranchMarker['kind'] = 'message',
): BranchMarker => ({
  turnId,
  kind,
  event: { type: 'session', sessionId },
});
const result = (turnId: string, messageId?: string): BranchMarker => ({
  turnId,
  kind: 'message',
  event: { type: 'result', ok: true, ...(messageId === undefined ? {} : { messageId }) },
});
const facts = { sessionId: 's', messageId: 'm', latest: false, compactedAfter: false };

describe('branchFacts', () => {
  it("reads the reply's session and last message id, and what ran on that session after it", () => {
    const markers = [
      session('a', 's1'),
      result('a', 'm-early'),
      result('a', 'm1'),
      session('b', 's2'),
      session('c', 's1', 'compact'),
    ];
    expect(branchFacts(markers, 'a')).toEqual({
      sessionId: 's1',
      messageId: 'm1',
      latest: false,
      compactedAfter: true,
    });
    expect(branchFacts(markers, 'b')).toEqual({
      sessionId: 's2',
      messageId: undefined,
      latest: true,
      compactedAfter: false,
    });
    const auto = [
      ...markers.slice(0, 2),
      session('d', 's1'),
      {
        turnId: 'd',
        kind: 'message',
        event: { type: 'compact', preTokens: 9, postTokens: null },
      } as BranchMarker,
    ];
    expect(branchFacts(auto, 'a').compactedAfter).toBe(true);
    expect(branchFacts([], 'x')).toEqual({
      sessionId: null,
      messageId: undefined,
      latest: true,
      compactedAfter: false,
    });
  });
});

describe('branchPoint', () => {
  it('forks the whole session from the latest reply, and up to an earlier one only where the harness can', () => {
    expect(branchPoint('latest', { ...facts, latest: true })).toEqual({ ok: true, resumeAt: null });
    expect(branchPoint('any', { ...facts, latest: true })).toEqual({ ok: true, resumeAt: null });
    expect(branchPoint('any', facts)).toEqual({ ok: true, resumeAt: 'm' });
    expect(branchPoint('latest', facts)).toMatchObject({
      code: 'branch_latest_only',
      message: LATEST_ONLY.codex,
    });
    expect(branchPoint('any', { ...facts, compactedAfter: true })).toMatchObject({
      message: LATEST_ONLY.compacted,
    });
    expect(branchPoint('any', { ...facts, messageId: undefined })).toMatchObject({
      message: LATEST_ONLY.unrecorded,
    });
    expect(branchPoint({ unsupported: 'No forks here' }, { ...facts, latest: true })).toEqual({
      ok: false,
      status: 409,
      code: 'branch_unsupported',
      message: 'No forks here',
    });
  });
});

describe('isBranchable and branchTitle', () => {
  it('takes finished message turns, and titles the branch after its parent, cut to fit', () => {
    for (const status of ['done', 'failed', 'stopped'] as const)
      expect(isBranchable({ kind: 'message', status })).toBe(true);
    expect(isBranchable({ kind: 'message', status: 'running' })).toBe(false);
    expect(isBranchable({ kind: 'compact', status: 'done' })).toBe(false);
    expect(branchTitle('Plan the release')).toBe('Plan the release (branch)');
    expect(branchTitle(null)).toBe('Chat (branch)');
    expect(branchTitle('x'.repeat(80))).toBe(`${'x'.repeat(71)} (branch)`);
    // A cut that ends on a space drops it.
    expect(branchTitle(`${'x'.repeat(70)} and more`)).toBe(`${'x'.repeat(70)} (branch)`);
  });
});

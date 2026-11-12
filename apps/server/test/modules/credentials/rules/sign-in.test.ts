import { describe, expect, it } from 'vitest';
import {
  accountChanged,
  claudeScreen,
  codexScreen,
  exitEnding,
  finishesOnExit,
  isActive,
  plainText,
  renewalRefusal,
  SIGN_IN_CODE,
  SIGN_IN_ENDINGS,
  SIGN_IN_STATES,
  takesCode,
} from '../../../../src/modules/credentials/rules/sign-in.ts';
import {
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_CODE,
  CLAUDE_OUTPUT,
  CODEX_DEVICE_URL,
  CODEX_OUTPUT,
  CODEX_USER_CODE,
} from '../../../fixtures/credentials/sign-in/cli.ts';

const ESC = '\u001b';

describe('the states', () => {
  it('are active until they end', () => {
    expect(SIGN_IN_STATES.filter(isActive)).toEqual([
      'starting',
      'waiting_for_user',
      'waiting_for_code',
      'completing',
    ]);
  });

  it("take Claude's code once the address is shown and until it is sent; OpenAI never takes one", () => {
    expect(SIGN_IN_STATES.filter((state) => takesCode('claude', state))).toEqual([
      'waiting_for_user',
      'waiting_for_code',
    ]);
    expect(SIGN_IN_STATES.filter((state) => takesCode('openai', state))).toEqual([]);
  });

  it("finish on a clean exit after Claude's code, or while OpenAI's code is shown", () => {
    expect(SIGN_IN_STATES.filter((state) => finishesOnExit('claude', state))).toEqual(['completing']);
    expect(SIGN_IN_STATES.filter((state) => finishesOnExit('openai', state))).toEqual([
      'waiting_for_user',
      'completing',
    ]);
  });

  it('say why a CLI that stopped early failed', () => {
    expect(exitEnding('claude', 'completing')).toBe(SIGN_IN_ENDINGS.codeRefused);
    expect(exitEnding('claude', 'starting')).toBe(
      'Claude did not show a sign-in address in time. Start again.',
    );
    expect(exitEnding('openai', 'waiting_for_user')).toBe(
      'The OpenAI sign-in stopped before it finished. Start again.',
    );
  });
});

describe('a pasted code', () => {
  it('is one word of URL-safe characters, 10 to 1000 of them', () => {
    expect(SIGN_IN_CODE.test(CLAUDE_CODE)).toBe(true);
    for (const bad of [
      'short',
      'a b c d e f g h',
      'abc\rdefghijk',
      'abcdefghij\n',
      'x'.repeat(1001),
      'abc;rm -rf/',
    ]) {
      expect(SIGN_IN_CODE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('plainText', () => {
  it('takes out colours, hyperlinks and titles, and makes carriage returns line ends', () => {
    expect(plainText(`${ESC}[94mblue${ESC}[0m\r\n${ESC}]0;title${ESC}\\x\rq${ESC}=`)).toBe('blue\nx\nq');
  });
});

describe('claudeScreen', () => {
  it("finds Anthropic's authorize address in the hyperlink and sees the prompt", () => {
    const opening = CLAUDE_OUTPUT.opening + CLAUDE_OUTPUT.address;
    expect(claudeScreen(CLAUDE_OUTPUT.opening)).toBeUndefined();
    expect(claudeScreen(opening)).toEqual({ url: CLAUDE_AUTHORIZE_URL, userCode: null, asksForCode: false });
    expect(claudeScreen(opening + CLAUDE_OUTPUT.prompt)).toMatchObject({ asksForCode: true });
  });

  it('reads a plain address too, and passes on only https addresses of the sign-in hosts and path', () => {
    const plain = `visit: ${CLAUDE_AUTHORIZE_URL.replace('claude.com', 'claude.ai')}\n`;
    expect(claudeScreen(plain)?.url).toMatch(/^https:\/\/claude\.ai\/cai\/oauth\/authorize\?/);
    for (const other of [
      'visit: https://evil.example/oauth/authorize?code=true',
      'visit: http://claude.com/cai/oauth/authorize?code=true',
      'visit: https://claude.com/somewhere/else',
      `${ESC}]8;;https://claude.com.evil.example/oauth/authorize${ESC}\\text${ESC}]8;;${ESC}\\`,
    ]) {
      expect(claudeScreen(other), other).toBeUndefined();
    }
  });
});

describe('codexScreen', () => {
  it("finds OpenAI's device page and the one-time code once both are on the screen", () => {
    expect(codexScreen(CODEX_OUTPUT.welcome + CODEX_OUTPUT.steps)).toBeUndefined();
    expect(codexScreen(CODEX_OUTPUT.welcome + CODEX_OUTPUT.steps + CODEX_OUTPUT.code)).toEqual({
      url: CODEX_DEVICE_URL,
      userCode: CODEX_USER_CODE,
      asksForCode: false,
    });
  });

  it('refuses another host, and finds a code on its own line without the usual wording', () => {
    expect(codexScreen(`Open https://auth.evil.example/codex/device\n  ABCD-EFGH\n`)).toBeUndefined();
    expect(codexScreen(`Open ${CODEX_DEVICE_URL}\n  WXYZ-12345\n`)).toMatchObject({ userCode: 'WXYZ-12345' });
  });
});

describe('signing in again', () => {
  it("renews only the caller's own subscription of the provider's kind that is not revoked", () => {
    expect(renewalRefusal('claude', { kind: 'claude_oauth', status: 'needs_sign_in' })).toBeUndefined();
    expect(renewalRefusal('openai', { kind: 'codex_oauth', status: 'active' })).toBeUndefined();
    expect(renewalRefusal('claude', undefined)).toMatchObject({ status: 404, code: 'credential_not_found' });
    expect(renewalRefusal('claude', { kind: 'codex_oauth', status: 'active' })).toMatchObject({
      status: 422,
      code: 'sign_in_kind_mismatch',
      message: 'Sign in with Claude signs in again only to a sign-in it added',
    });
    expect(renewalRefusal('openai', { kind: 'claude_setup_token', status: 'active' })).toMatchObject({
      code: 'sign_in_kind_mismatch',
    });
    expect(renewalRefusal('openai', { kind: 'codex_oauth', status: 'revoked' })).toMatchObject({
      status: 422,
      code: 'credential_revoked',
    });
  });

  it('sees another account only when both emails are known and differ, letter case aside', () => {
    expect(accountChanged('ihor@example.test', 'other@example.test')).toBe(true);
    expect(accountChanged('Ihor@Example.test', 'ihor@example.test')).toBe(false);
    expect(accountChanged(null, 'ihor@example.test')).toBe(false);
    expect(accountChanged('ihor@example.test', null)).toBe(false);
  });
});

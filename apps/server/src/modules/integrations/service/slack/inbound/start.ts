import type { SlackApi, SlackSockets } from '@mwc/tools-core';
import type { ServerDeps } from '../../../../../platform/env.ts';
import { SYSTEM_TIMERS, type Timers } from '../../../../../platform/jobs/runner.ts';
import type { Keyring } from '../../../../../platform/secrets/keyring.ts';
import type { InboundChats, InboundTurnHook } from '../../../../chats/index.ts';
import { credentialsForTools } from '../../../../credentials/index.ts';
import { type SlackInbound, slackInbound } from './connections.ts';
import { slackReplies } from './reply.ts';

/**
 * Receiving Slack messages as `app.ts` composes it (2026-11-13): the answers' hook, which the chats runtime is made with,
 * and the connections, started once the runtime gives its port, in this process since it holds the chats' live turns:
 * when the server runs its background work (MWC_JOBS) or a test passes its timers, stopped with the server. Off, saving
 * a sign-in's settings only stores them.
 */
export function slackReceiving(deps: ServerDeps & { readonly keyring: Keyring; readonly slack: SlackApi }) {
  const base = { ...deps, credentials: credentialsForTools(deps) };
  return {
    answers: slackReplies(base) satisfies InboundTurnHook,
    start(chats: InboundChats, sockets: SlackSockets, timers: Timers | undefined): SlackInbound | undefined {
      if (!deps.config.MWC_JOBS && timers === undefined) return undefined;
      const inbound = slackInbound({ ...base, chats, sockets, timers: timers ?? SYSTEM_TIMERS });
      void inbound.start();
      deps.onShutdown?.(async () => inbound.stop());
      return inbound;
    },
  };
}

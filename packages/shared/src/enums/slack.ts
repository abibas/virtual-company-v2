import { z } from 'zod';

/**
 * Receiving Slack messages (2026-11-13, docs/subscriptions.md "Slack: receiving messages"), re-exported by `../enums.ts`
 * with the other database enums: who may wake agents through a Slack connection, and where its Socket Mode stands.
 */

/**
 * `slack_connections.wake`: who may wake agents from Slack: anyone in the channels the agent's profile reaches
 * (`anyone`), or only the people listed (`listed`, the default).
 */
export const SlackWake = z.enum(['anyone', 'listed']);
export type SlackWake = z.infer<typeof SlackWake>;

/**
 * `slack_connections.status`: its Socket Mode connection: not running (`off`), opening, open, closed and trying again,
 * or stopped by a refusal (`error`, said in `status_message`).
 */
export const SlackInboundStatus = z.enum(['off', 'connecting', 'connected', 'disconnected', 'error']);
export type SlackInboundStatus = z.infer<typeof SlackInboundStatus>;

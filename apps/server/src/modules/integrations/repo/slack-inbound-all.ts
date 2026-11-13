import { type DbHandle, slackConnections } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';

/**
 * The Slack connections that receive messages, across every person (2026-11-13): the one place this module reads
 * without the personal layer, listed in biome.json's exemption, since the server keeps a Socket Mode connection for
 * anyone's. It only finds; each connection is read and changed through its owner's layer (`repo/slack-inbound.ts`).
 */

/** Every sign-in with receiving on, and whose it is. */
export async function receivingConnections(
  db: DbHandle,
): Promise<{ readonly credentialId: string; readonly ownerUserId: string }[]> {
  return rawDb(db)
    .select({ credentialId: slackConnections.credentialId, ownerUserId: slackConnections.ownerUserId })
    .from(slackConnections)
    .where(eq(slackConnections.inbound, true));
}

import type { InferResponseType } from 'hono/client';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { useEvery } from './notifications.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A flow's team room (`/api/companies/:companyId/flows/:flowId/room`, docs/processes.md "The team room"): its feed (read
 * again every 4 seconds while the page is visible), a person's message, and its cap. The types are inferred from the
 * server's routes.
 */

type RoomRoutes = Api['api']['companies'][':companyId']['flows'][':flowId']['room'];

export type Room = InferResponseType<RoomRoutes['$get'], 200>;
export type RoomMessage = Room['messages'][number];
export type RoomMember = Room['members']['agents'][number];

/** How often an open room is read again while the page is visible. */
export const ROOM_EVERY_MS = 4_000;

const roomOf = (api: Api) => api.api.companies[':companyId'].flows[':flowId'].room;

/** The room of a flow: its latest messages, who is in it and whether the reader writes there. */
export function useRoom(companyId: string, flowId: string): Loaded<Room> {
  const api = useApi();
  const loaded = useLoad(`room:${companyId}:${flowId}`, () =>
    call(roomOf(api).$get({ param: { companyId, flowId }, query: {} })),
  );
  useEvery(ROOM_EVERY_MS, loaded.reload);
  return loaded;
}

/** The room's changes in one company: a message, an older page, the cap. */
export function roomCalls(api: Api, companyId: string) {
  return {
    say: (flowId: string, body: string) =>
      call(roomOf(api).messages.$post({ param: { companyId, flowId }, json: { body } })),
    older: (flowId: string, before: string) =>
      call(roomOf(api).$get({ param: { companyId, flowId }, query: { before } })),
    putCap: (flowId: string, maxPerHour: number) =>
      call(roomOf(api).$put({ param: { companyId, flowId }, json: { maxPerHour } })),
  };
}

export type RoomCalls = ReturnType<typeof roomCalls>;

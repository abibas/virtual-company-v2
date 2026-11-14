import type { InferRequestType, InferResponseType } from 'hono/client';
import { useCallback, useMemo, useState } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The decision log (2026-11-14, `GET /api/companies/:companyId/decisions`, members and above): what the agents recorded
 * with `record_decision`, newest first, by agent, chat, task, contact or outcome, a page at a time. A chat's decisions
 * also come live on its stream (`use-chat-live.ts` puts them in). The types are inferred from the server's routes.
 */

type DecisionRoutes = Api['api']['companies'][':companyId']['decisions'];
export type DecisionList = InferResponseType<DecisionRoutes['$get'], 200>;
export type Decision = DecisionList['decisions'][number];
export type DecisionOutcome = NonNullable<Decision['outcome']>;
export type DecisionQuery = NonNullable<InferRequestType<DecisionRoutes['$get']>['query']>;

/** The most a chat's thread asks for at once: its latest decisions. */
const CHAT_DECISIONS = '200';

export interface LiveDecisions extends Loaded<DecisionList> {
  /** The first page's decisions, then those of the pages added with `more`, each once. */
  readonly rows: readonly Decision[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** Adds the next page below. */
  more(): Promise<void>;
}

/** The pages after the first, for one filter. */
interface Later {
  readonly key: string;
  readonly rows: readonly Decision[];
  readonly next: string | null;
}

/** The company's decisions matching `query`, a page at a time (the agent's page, the task's). */
export function useDecisions(companyId: string, query: DecisionQuery): LiveDecisions {
  const api = useApi();
  const key = `decisions:${companyId}:${JSON.stringify(query)}`;
  const routes = api.api.companies[':companyId'].decisions;
  const loaded = useLoad(key, () => call(routes.$get({ param: { companyId }, query })));
  const [later, setLater] = useState<Later>({ key, rows: [], next: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const own = later.key === key ? later : undefined;
  const next = own ? own.next : (loaded.data?.nextBefore ?? null);
  const more = useCallback(async () => {
    if (next === null) return;
    setLoadingMore(true);
    try {
      const page = await call(routes.$get({ param: { companyId }, query: { ...query, before: next } }));
      setLater((was) => ({
        key,
        rows: [...(was.key === key ? was.rows : []), ...page.decisions],
        next: page.nextBefore,
      }));
    } finally {
      setLoadingMore(false);
    }
  }, [companyId, key, next, query, routes]);
  const rows = useMemo(() => [...(loaded.data?.decisions ?? []), ...(own?.rows ?? [])], [loaded.data, own]);
  return { ...loaded, rows, hasMore: next !== null, loadingMore, more };
}

/** A chat's decisions: loaded once, again on `reload` (a fresh detail), with those its stream brought (`put`). */
export function useChatDecisions(companyId: string, chatId: string) {
  const api = useApi();
  const routes = api.api.companies[':companyId'].decisions;
  const loaded = useLoad(`decisions:${companyId}:chat:${chatId}`, () =>
    call(routes.$get({ param: { companyId }, query: { chat: chatId, limit: CHAT_DECISIONS } })),
  );
  const [streamed, setStreamed] = useState<readonly Decision[]>([]);
  const put = useCallback((decision: Decision) => {
    setStreamed((was) => (was.some((d) => d.id === decision.id) ? was : [...was, decision]));
  }, []);
  const decisions = useMemo(() => {
    const known = new Map((loaded.data?.decisions ?? []).map((d) => [d.id, d]));
    for (const decision of streamed) if (decision.chatId === chatId) known.set(decision.id, decision);
    return [...known.values()];
  }, [loaded.data, streamed, chatId]);
  return { decisions, put, reload: loaded.reload };
}

/** Each turn's decisions, oldest first. */
export function decisionsByTurn(decisions: readonly Decision[]): ReadonlyMap<string, readonly Decision[]> {
  const byTurn = new Map<string, Decision[]>();
  const oldestFirst = [...decisions].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  for (const decision of oldestFirst)
    byTurn.set(decision.turnId, [...(byTurn.get(decision.turnId) ?? []), decision]);
  return byTurn;
}

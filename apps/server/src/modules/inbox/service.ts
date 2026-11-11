import { type DbHandle, type TenantDb, tenant } from '@mwc/db';
import type { Actor } from '../../platform/auth/actor.ts';
import { companiesOf } from '../identity/service.ts';
import { inboxRepo } from './repo.ts';
import { byUrgency, type Viewer } from './rules.ts';
import type { InboxCompany, InboxItem, MyInbox } from './schemas.ts';
import { questionItems } from './service/questions.ts';
import { taskItems } from './service/tasks.ts';

/**
 * The inbox (S6b, docs/processes.md "Built in S6b"): what needs the caller now, computed live on each read from the
 * tasks (`service/tasks.ts`) and the chats' open questions (`service/questions.ts`), the most urgent first
 * (`byUrgency`). One company's, or every company of the caller's (`GET /api/me/inbox`). It writes nothing: every item
 * leads to the routes that already act on it (the task's moves, the chat's answers).
 */

const rankOf = (item: InboxItem) => ({ kind: item.kind, priority: item.task?.priority ?? null, at: item.at });

/** The company as an item names it. */
export const companyRef = (t: TenantDb): InboxCompany => ({
  id: t.companyId,
  slug: t.company.slug,
  name: t.company.name,
});

/** What needs the viewer in one company, the most urgent first. */
export async function companyInbox(
  deps: { readonly db: DbHandle },
  t: TenantDb,
  viewer: Viewer,
): Promise<InboxItem[]> {
  const company = companyRef(t);
  const tasks = await taskItems(deps, inboxRepo, t, viewer, company);
  const questions = await questionItems(deps, inboxRepo, t, viewer, company);
  return [...tasks, ...questions].sort((a, b) => byUrgency(rankOf(a), rankOf(b)));
}

/**
 * What needs the caller across their companies (each where their membership is active), the most urgent first, with
 * each company's count by name. An API key acts in its own company only, so its inbox is that company's.
 */
export async function myInbox(deps: { readonly db: DbHandle }, actor: Actor): Promise<MyInbox> {
  const items: InboxItem[] = [];
  const companies: MyInbox['companies'] = [];
  const userId = actor.userId as string;
  for (const company of await companiesOf(deps.db, actor)) {
    if (company.status !== 'active') continue;
    const t = await tenant(deps.db, company.companyId);
    // Listed as theirs and active just now.
    const member = (await inboxRepo.memberOf(t, userId)) as Viewer;
    const found = await companyInbox(deps, t, member);
    items.push(...found);
    companies.push({ ...companyRef(t), count: found.length });
  }
  items.sort((a, b) => byUrgency(rankOf(a), rankOf(b)));
  return { items, count: items.length, companies };
}

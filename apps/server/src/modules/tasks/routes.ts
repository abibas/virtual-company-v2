import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { actionRoutes } from './routes/actions.ts';
import { artifactRoutes } from './routes/artifacts.ts';
import { boardRoutes } from './routes/board.ts';
import { flowRoutes } from './routes/flows.ts';
import { roomRoutes } from './routes/room.ts';
import { taskRoutes } from './routes/tasks.ts';
import { wakeRoutes } from './routes/wakes.ts';
import type { RoomDeps } from './service/room/members.ts';
import type { RunDeps } from './service/runs.ts';
import { tasksService } from './service.ts';

/**
 * The tasks module's routes (S5.3a, docs/processes.md): a team's flow and its steps (`routes/flows.ts`), its written
 * form and board (`routes/board.ts`), its tasks (`routes/tasks.ts`), their moves (`routes/actions.ts`) and (S5.3b)
 * their artifacts (`routes/artifacts.ts`), (S6c) the Lead's wake-up settings (`routes/wakes.ts`) and the flow's team
 * room (`routes/room.ts`). With the chats module's `steps` (`app.ts`), a move that starts a task at an agent's step runs
 * it; with its `team`, a person's message in a team room asks the team's agents.
 */
export function tasksRoutes(deps: ServerDeps & Pick<RunDeps, 'steps'> & Pick<RoomDeps, 'team'>) {
  const tasks = tasksService(deps);
  return newRouter()
    .route('/', flowRoutes(deps, tasks))
    .route('/', boardRoutes(deps, tasks))
    .route('/', taskRoutes(deps, tasks))
    .route('/', actionRoutes(deps, tasks))
    .route('/', artifactRoutes(deps, tasks))
    .route('/', wakeRoutes(deps, tasks))
    .route('/', roomRoutes(deps, tasks));
}

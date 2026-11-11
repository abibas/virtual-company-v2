/**
 * The flows' and tasks' limits (S5.3a): what the API's schemas, the database's CHECKs and the agents' tools (S6a) share.
 * Kept apart from `../flows.ts` so the parts it re-exports (the prompt, the tools) can use them without a cycle.
 */

/** A flow's name ("DEVBOX delivery"), after trimming. */
export const FLOW_NAME = { min: 1, max: 80 } as const;

/** A step's name ("Code review"), after trimming; unique in its flow, whatever the case. */
export const STEP_NAME = { min: 1, max: 60 } as const;

/** The most steps a flow has. */
export const FLOW_STEPS_MAX = 20;

/** A Check or Sign-off step's send-back limit: after this many send-backs the task goes to the Lead. */
export const SEND_BACK_LIMIT = { min: 1, max: 99 } as const;

/** A task's title, after trimming. */
export const TASK_TITLE = { min: 1, max: 200 } as const;

/** A task's description, markdown. */
export const TASK_DESCRIPTION_MAX = 50_000;

/** A move's reason: why a task was sent back, cancelled or routed. */
export const TASK_REASON_MAX = 2_000;

/** How many done tasks the board shows (the latest), unless asked for fewer or more. */
export const BOARD_DONE = { default: 10, max: 50 } as const;

/** A page of the task list. */
export const TASK_PAGE = { default: 50, max: 200 } as const;

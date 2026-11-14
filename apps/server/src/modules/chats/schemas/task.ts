import { z } from '@hono/zod-openapi';
import { TaskState } from '@mwc/shared/enums';

/**
 * A task's conversation as an agent's chat list and its open chat name it (2026-11-14, T-19; docs/harness.md "Task
 * conversations in the agent's chats"): the task by its key and title, the step by its name and the rounds the
 * conversation covers (a Keep step's one conversation spans its rounds, a Fresh step has one per round), and where the
 * task stands, all read now.
 */

export const ChatTaskSchema = z
  .object({
    taskId: z.string(),
    key: z.string().openapi({ example: 'T-18' }),
    title: z.string().openapi({ description: "The task's title now", example: 'Chat images' }),
    step: z.string().openapi({
      description: "The step's name now; `a removed step` for one removed since",
      example: 'Develop',
    }),
    rounds: z.object({ from: z.number().int().min(1), to: z.number().int().min(1) }).openapi({
      description:
        "The step's rounds the conversation covers: from the round it began in up to the round before the step's " +
        'next conversation began, the latest one up to the rounds the task has had at the step so far',
    }),
    /** The task's state now. */
    state: TaskState,
    atStep: z.boolean().openapi({ description: "The task is active at this conversation's step now" }),
  })
  .openapi('ChatTask');

export const chatTaskField = {
  forTask: ChatTaskSchema.nullable().openapi({
    description:
      "The task a task's conversation is for (its key, title, step and rounds); null for any other chat",
  }),
};

export type ChatTaskView = z.infer<typeof ChatTaskSchema>;

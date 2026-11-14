import type { AgentTool } from './tools.ts';

/**
 * The agents' tools' words (S6a): what each tool is for, as the runner's `tools/list` entry says it, and the Lead's
 * section of its chats' standing instructions. The names and inputs are `tools.ts`.
 */

/** What each tool is for, as its `tools/list` entry says it. */
export const AGENT_TOOL_INFO: Readonly<
  Record<AgentTool, { readonly title: string; readonly description: string }>
> = {
  task_read: {
    title: 'Read the task',
    description:
      'Your task: its key, title and description, its flow, the step it is at and its state, the round, how it came ' +
      'to you (the reason and findings of a send-back, the last hand-off) and its artifacts.',
  },
  task_hand_on: {
    title: 'Hand the task on',
    description:
      'Your work is done: record your hand-off. The task goes to the next step when your turn ends; end it now.',
  },
  task_pass: {
    title: 'Pass the task',
    description:
      'The work passes your check. The task goes to the next step when your turn ends; end it now.',
  },
  task_approve: {
    title: 'Approve the task',
    description: 'Approve it. The task goes to the next step, or is done, when your turn ends; end it now.',
  },
  task_send_back: {
    title: 'Send the task back',
    description:
      'The work needs changes: send it back with why and your findings. It goes back when your turn ends (past ' +
      'the step’s limit, to the team’s Lead instead); end it now.',
  },
  task_attach: {
    title: 'Attach to the task',
    description:
      'Keep something with the task now: a note (name and text), a file from your outputs folder (path) or a link ' +
      '(name and url). Text and images up to 2 MB.',
  },
  task_blocked: {
    title: 'Report blocked',
    description:
      'You cannot go on: say why. The task is marked blocked when your turn ends, for a person to unblock; end it now.',
  },
  team_board: {
    title: 'Team board',
    description:
      'Your flow’s board: Queued, each step, Done and Escalated, with each task’s state and who has it.',
  },
  task_show: {
    title: 'Show a task',
    description: 'One task of your flow: where it is, its description, its history and its artifacts.',
  },
  task_create: {
    title: 'Create a task',
    description:
      'A new task in your flow, queued or put into a step at once (which starts it if the step starts by itself).',
  },
  task_route: {
    title: 'Route a task',
    description: 'Put a task of your flow into a step (a queued, active or escalated one). Acts at once.',
  },
  task_start: {
    title: 'Start a task',
    description: 'Start a task waiting, blocked or ended at its step: its step’s agent runs. Acts at once.',
  },
  task_retry: {
    title: 'Retry a task',
    description: 'Retry an escalated task: it goes where its stopped send-back was going. Acts at once.',
  },
  task_cancel: {
    title: 'Cancel a task',
    description: 'Cancel a task of your flow, saying why. Acts at once.',
  },
  record_decision: {
    title: 'Record a decision',
    description:
      'Record a real decision you made, for the people you work for to read later: what you decided, why, the ' +
      'links and references you relied on, and the outcome when one fits. Use it for approving or rejecting a ' +
      'review, accepting or declining a request, choosing between options that matter, or refusing something; not ' +
      'for routine steps.',
  },
};

/**
 * The Lead's section of its chats' standing instructions while its runner offers the tools: brief, naming them. The
 * board is the agent's to read; its steps' agents move their own tasks. It never waits inside a turn (Most Wanted wakes
 * it in its team chat when a task needs it, and at its flow's check-ins) and never does a step's work itself.
 */
export function leadSection(flowName: string): string {
  return [
    '## Leading your team (from Most Wanted)',
    '',
    `You lead the flow "${flowName.replace(/\s+/g, ' ').trim()}". Your tools act at once, as you: team_board, ` +
      'task_show {key}, task_create {title, description?, priority?, step?}, task_route {key, step}, ' +
      'task_start {key}, task_retry {key} and task_cancel {key, reason}. Each step’s agent moves its own task ' +
      'when its turn ends; you distribute the work, unblock it, and decide on escalations.',
    '',
    '- Never wait or poll for a step’s agent inside your turn. Once you have created, started or routed tasks, ' +
      'report in a line and end your turn: Most Wanted wakes you in your team chat when a task needs you, and at ' +
      'regular check-ins.',
    '- Never edit a step’s files or artifacts: that is its agent’s work. Say what is wrong, then route the task ' +
      'back (task_route) or start the step again (task_start).',
  ].join('\n');
}

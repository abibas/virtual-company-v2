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
  task_reopen: {
    title: 'Reopen the task',
    description:
      'The task is done (or cancelled) but the person says it is wrong: reopen it with their correction (why, and ' +
      'your findings: what is wrong, where, what to change). It goes back to the step your step sends back to, as ' +
      'a new round in that step’s same conversation, when your turn ends; end it now. Never file a new task for ' +
      'a correction of this one.',
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
      'A new task in your flow, queued or put into a step at once (which starts it if the step starts by itself). ' +
      'Queued with autoTake true, the flow’s Autotake takes it by itself; with false, it waits for a person. ' +
      'Left out, step and autoTake are the flow’s defaults for new tasks. waitsFor: the tasks it waits for; after: ' +
      'its place in Queued, right after that queued task (else the end of its priority).',
  },
  task_queue: {
    title: 'Plan the queue',
    description:
      'Change a queued task of your flow at once: its place in Queued (before or after another queued task), the ' +
      'tasks it waits for (waitsFor, the whole list; [] for none), Autotake and priority. Autotake takes queued ' +
      'tasks by priority, then their place, skipping one while a task it waits for is not done or cancelled.',
  },
  task_route: {
    title: 'Route a task',
    description:
      'Put a task of your flow into a step (a queued, active or escalated one). A done or cancelled task is ' +
      'reopened there, as a new round, with a reason (required): use it when someone says a closed task is wrong, ' +
      'never a new task. Acts at once.',
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

/** A flow's defaults for new tasks in words (T-38): `Queued, Autotake`, `"Develop"` (a step skips Queued). */
export function newTasksWords(defaults: {
  readonly stepName: string | null;
  readonly autoTake: boolean;
}): string {
  if (defaults.stepName !== null) return `"${defaults.stepName}"`;
  return `Queued, ${defaults.autoTake ? 'Autotake' : 'Manual'}`;
}

/**
 * The Lead's section of its chats' standing instructions while its runner offers the tools: brief, naming them, and
 * what task_create does with what is left out (the flow's defaults for new tasks as they are now, T-38). The board is
 * the agent's to read; its steps' agents move their own tasks. It never waits inside a turn (Most Wanted wakes it in its
 * team chat when a task needs it, and at its flow's check-ins) and never does a step's work itself.
 */
export function leadSection(
  flowName: string,
  newTasks: { readonly stepName: string | null; readonly autoTake: boolean } = {
    stepName: null,
    autoTake: false,
  },
): string {
  return [
    '## Leading your team (from Most Wanted)',
    '',
    `You lead the flow "${flowName.replace(/\s+/g, ' ').trim()}". Your tools act at once, as you: team_board, ` +
      'task_show {key}, task_create {title, description?, priority?, autoTake?, step?, waitsFor?, after?}, ' +
      'task_queue {key, before? | after?, waitsFor?, autoTake?, priority?}, task_route {key, step, reason?}, ' +
      'task_start {key}, task_retry {key} and task_cancel {key, reason}. Each step’s agent moves its own task ' +
      'when its turn ends; you distribute the work, unblock it, and decide on escalations.',
    '',
    `- task_create without step or autoTake: left out, the flow’s default (now: new tasks go to ${newTasksWords(newTasks)}). ` +
      'Say them only to do otherwise for that task (step: "Queued" keeps it in Queued).',
    '- Never wait or poll for a step’s agent inside your turn. Once you have created, started or routed tasks, ' +
      'report in a line and end your turn: Most Wanted wakes you in your team chat when a task needs you, and at ' +
      'regular check-ins.',
    '- Never edit a step’s files or artifacts: that is its agent’s work. Say what is wrong, then route the task ' +
      'back (task_route) or start the step again (task_start).',
    '- When someone says a done task is wrong, reopen it: task_route {key, step, reason: their correction} puts it ' +
      'back into that step as a new round, in its same conversation. Never file a new task for it.',
    '',
    '### Planning the queue',
    '',
    'Autotake takes queued tasks by priority, then their place in Queued, and skips a task while a task it waits ' +
      'for is not done or cancelled. When you file several tasks, decide their sequence: create them in order (or ' +
      'use after), and make a task that needs another’s code, or touches the same files or schema (migrations ' +
      'especially), wait for it (waitsFor). Small, independent fixes are Autotake; big ones, or ones the person has ' +
      'not reviewed, stay Manual. Put the most urgent first. task_queue changes a queued task’s place, waits, ' +
      'Autotake and priority later. When the person files many, say the sequence back in one line ' +
      '(e.g. "T-12 → T-13 (waits for T-12) → T-14").',
  ].join('\n');
}

/**
 * What a turn's standing instructions get when its runner is too old for some of the tools the server would give it
 * (T-29, `caps.agentToolNames`): which ones, and that their move is a person's, never the agent's own doing. Without it
 * a missing tool dropped out unsaid, and an agent told to reopen a task did the work itself.
 */
export function missingToolsSection(tools: readonly string[]): string {
  return [
    '## Tools you lack on this machine (from Most Wanted)',
    '',
    `This machine's runner is older than some of your tools and does not offer them: ${tools.join(', ')}. ` +
      'Where your instructions say to call one of them, do not work around it and never do yourself the work it ' +
      'would send to another step (no code, file or deploy changes for it). Say in your reply which tool you lack ' +
      'and what it would have done (for a task: the move, with its reason and findings), and that the machine’s ' +
      'runner needs an update; a person then makes the move (a closed task: Reopen… on its page).',
  ].join('\n');
}

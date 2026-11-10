import {
  BookOpen,
  Bot,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  ListChecks,
  type LucideIcon,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { article, basename, clip, plural } from './format.ts';

/**
 * A tool call in plain words (S5.2): what kind of tool it is, its icon, how it reads while it runs ("Running
 * `pnpm test`") and once done ("Ran `pnpm test`"), and how several of a kind add up ("ran 3 commands"). The names are
 * Claude Code's tools (`Bash`, `Read`, `Edit`, `Agent`…), Codex's (`command`, `file_change`, `spawn_agent`) and MCP tools
 * (`mcp__server__tool`, `mcp:server/tool`); any other tool is "used". Pure.
 */

export type ToolFamily =
  | 'command'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'web_search'
  | 'fetch'
  | 'agent'
  | 'todo'
  | 'skill'
  | 'mcp'
  | 'other';

const NAMES: Readonly<Record<string, ToolFamily>> = {
  bash: 'command',
  command: 'command',
  shell: 'command',
  bashoutput: 'command',
  read: 'read',
  notebookread: 'read',
  edit: 'edit',
  multiedit: 'edit',
  notebookedit: 'edit',
  file_change: 'edit',
  write: 'write',
  grep: 'search',
  glob: 'search',
  ls: 'search',
  toolsearch: 'search',
  websearch: 'web_search',
  web_search: 'web_search',
  webfetch: 'fetch',
  agent: 'agent',
  task: 'agent',
  spawn_agent: 'agent',
  todowrite: 'todo',
  skill: 'skill',
};

interface FamilyWords {
  readonly icon: LucideIcon;
  /** The verbs while it runs and once done, before the target. */
  readonly running: string;
  readonly done: string;
  /** How several add up, after the past verb: "ran 3 commands". */
  readonly verb: string;
  readonly one: string;
  readonly many: string;
}

const WORDS: Readonly<Record<ToolFamily, FamilyWords>> = {
  command: {
    icon: SquareTerminal,
    running: 'Running',
    done: 'Ran',
    verb: 'ran',
    one: 'command',
    many: 'commands',
  },
  read: { icon: FileText, running: 'Reading', done: 'Read', verb: 'read', one: 'file', many: 'files' },
  edit: { icon: FilePen, running: 'Editing', done: 'Edited', verb: 'edited', one: 'file', many: 'files' },
  write: { icon: FilePlus, running: 'Writing', done: 'Wrote', verb: 'wrote', one: 'file', many: 'files' },
  search: {
    icon: Search,
    running: 'Searching for',
    done: 'Searched for',
    verb: 'ran',
    one: 'search',
    many: 'searches',
  },
  web_search: {
    icon: Globe,
    running: 'Searching the web for',
    done: 'Searched the web for',
    verb: 'ran',
    one: 'web search',
    many: 'web searches',
  },
  fetch: { icon: Globe, running: 'Fetching', done: 'Fetched', verb: 'fetched', one: 'page', many: 'pages' },
  agent: { icon: Bot, running: 'Spawning', done: 'Spawned', verb: 'started', one: 'agent', many: 'agents' },
  todo: {
    icon: ListChecks,
    running: 'Updating the to-dos',
    done: 'Updated the to-dos',
    verb: 'updated',
    one: 'to-do list',
    many: 'to-do lists',
  },
  skill: { icon: BookOpen, running: 'Loading', done: 'Loaded', verb: 'loaded', one: 'skill', many: 'skills' },
  mcp: { icon: Plug, running: 'Calling', done: 'Called', verb: 'called', one: 'tool', many: 'tools' },
  other: { icon: Wrench, running: 'Using', done: 'Used', verb: 'called', one: 'tool', many: 'tools' },
};

/** The kind of a tool, from its name. */
export function familyOf(name: string): ToolFamily {
  if (/^mcp(__|:)/i.test(name)) return 'mcp';
  return NAMES[name.toLowerCase()] ?? 'other';
}

export function toolIcon(name: string): LucideIcon {
  return WORDS[familyOf(name)].icon;
}

/** An MCP tool's own name: `mcp__github__create_issue` → "create_issue", `mcp:jira/search` → "search". */
function mcpTool(name: string): string {
  return name.replace(/^mcp__.+?__/i, '').replace(/^mcp:[^/]*\//i, '');
}

/** A tool call's words: a verb, and what it acts on (shown as code) when there is one. */
export interface ToolWords {
  readonly verb: string;
  readonly target?: string;
}

/** What the call acts on, short: a file's name, a command, a host. */
function targetOf(family: ToolFamily, name: string, summary: string): string | undefined {
  const line = summary.trim();
  if (family === 'mcp') return mcpTool(name);
  if (family === 'other') return name;
  if (family === 'todo' || line === '') return undefined;
  if (family === 'read' || family === 'write' || (family === 'edit' && !line.includes(' ')))
    return basename(line);
  if (family === 'fetch') return /^https?:\/\/([^/]+)/i.exec(line)?.[1] ?? clip(line, 48);
  if (family === 'search') return clip(line.replace(/ in \S+$/, ''), 48);
  return clip(line, 56);
}

/** A subagent's type as a name: "Explore agent", and Codex's "Codex agent" as it is. */
export function agentName(agentType: string): string {
  return /\bagent$/i.test(agentType.trim()) ? agentType : `${agentType} agent`;
}

/**
 * A call's words while it runs or once done. An agent call names its subagent's type when it is known
 * ("Spawning an Explore agent", "Spawned a Codex agent").
 */
export function toolWords(name: string, summary: string, done: boolean, agentType?: string): ToolWords {
  const family = familyOf(name);
  const words = WORDS[family];
  const verb = done ? words.done : words.running;
  if (family === 'agent') {
    return {
      verb: agentType ? `${verb} ${article(agentType)} ${agentName(agentType)}` : `${verb} a subagent`,
    };
  }
  if (family === 'skill' && summary.trim()) return { verb: `${verb} the skill`, target: clip(summary, 40) };
  if (family === 'edit' && summary.includes(' '))
    return { verb: done ? 'Changed files:' : 'Changing files:', target: clip(summary, 56) };
  const target = targetOf(family, name, summary);
  return target === undefined ? { verb } : { verb, target };
}

/**
 * Several calls added up, in the order their kinds first came: "Ran 3 commands, read 2 files". The first part starts
 * with a capital.
 */
export function addUp(names: readonly string[]): string {
  const counts = new Map<string, { words: FamilyWords; count: number }>();
  for (const name of names) {
    const words = WORDS[familyOf(name)];
    const key = `${words.verb} ${words.many}`;
    const known = counts.get(key);
    if (known) known.count += 1;
    else counts.set(key, { words, count: 1 });
  }
  const text = [...counts.values()]
    .map(({ words, count }) => `${words.verb} ${plural(count, words.one, words.many)}`)
    .join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

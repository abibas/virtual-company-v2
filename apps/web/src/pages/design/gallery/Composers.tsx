import { NO_OVERRIDES, type Runs, type RunsOverrides } from '@mwc/shared/modes';
import { type ReactNode, useState } from 'react';
import { PublicConfigContext } from '../../../api/config.ts';
import { ApiContext } from '../../../api/context.ts';
import { Composer } from '../../../features/chats/Composer.tsx';
import { ContextMeter } from '../../../features/chats/context/ContextMeter.tsx';
import type { ConversationControls } from '../../../features/chats/context/ConversationActions.tsx';
import type { ConversationView } from '../../../features/chats/context/context-state.ts';
import { RunsMenus } from '../../../features/chats/runs/RunsMenus.tsx';
import { runsView } from '../../../features/chats/runs/runs-state.ts';
import { SAMPLE_CONFIG } from '../flows/SampleThread.tsx';
import { sampleApi } from '../records.ts';
import { Example, Section } from './Section.tsx';

/** The sample chat's profile: Skip prompts, Opus 5.5 at X-high. */
const PROFILE: Runs = { mode: 'bypassPermissions', model: 'claude-opus-5-5', effort: 'xhigh' };
const WINDOW = 1_000_000;

/** A sample conversation of `used` tokens in a 1M window, as the context meter reads it. */
function sampleConversation(used: number): ConversationView {
  return {
    used,
    window: WINDOW,
    percent: Math.round((used / WINDOW) * 100),
    baseline: 0,
    estimate: false,
    model: PROFILE.model,
    effort: 'xhigh',
    base: { tokens: Math.min(used, 18_400), after: 'start' },
    lastTurn: undefined,
    session: {
      turns: 6,
      tokens: used * 3,
      uncached: Math.round(used / 4),
      costUsd: undefined,
      onPlan: true,
      since: undefined,
      afterClear: false,
    },
    commands: undefined,
    hasConversation: true,
  };
}

/** Compact and Clear on the samples: offered, doing nothing. */
const CONTROLS: ConversationControls = {
  canCompact: true,
  compactBlocked: undefined,
  clearBlocked: undefined,
  busy: undefined,
  error: undefined,
  compact: () => undefined,
  clear: async () => false,
};

/** The Mode and Model menus on a sample chat; a choice changes the sample at once (nothing is saved). */
function SampleRuns({ overrides }: { readonly overrides: RunsOverrides }) {
  const [own, setOwn] = useState(overrides);
  return (
    <RunsMenus
      view={runsView({ harness: 'claude_code', overrides: own }, PROFILE)}
      onChange={async (patch) => setOwn((was) => ({ ...was, ...patch }))}
    />
  );
}

/** A sample chat's composer footer parts: its menus (`overrides` the chat's own) and its meter at `used` tokens. */
export function sampleComposerParts(used: number, overrides: RunsOverrides = NO_OVERRIDES) {
  return {
    runs: <SampleRuns overrides={overrides} />,
    meter: <ContextMeter view={sampleConversation(used)} controls={CONTROLS} />,
  };
}

const refuse = () => Promise.reject(new Error('Sample data: nothing is sent here'));

/** One composer at a card width in px (the dense composer adds 4 px a side), dictation on. */
function Sample({
  width,
  running = false,
  children,
}: {
  readonly width: number;
  readonly running?: boolean;
  readonly children: { readonly runs: ReactNode; readonly meter: ReactNode };
}) {
  return (
    <div style={{ width: width + 8 }} className="max-w-full">
      <Composer
        dense
        running={running}
        choices={undefined}
        disabled={undefined}
        placeholder="Message Vega"
        onSend={refuse}
        onStop={refuse}
        runs={children.runs}
        meter={children.meter}
      />
    </div>
  );
}

const PLAN = { ...NO_OVERRIDES, mode: 'plan' } as const;

/**
 * The chat's composer at the widths it lives in (2026-11-13): the full chat page, the rail's docked chat and a phone.
 * One footer row that never wraps; the words drop by the card's width.
 */
export function ComposersSection() {
  const [api] = useState(sampleApi);
  return (
    <ApiContext value={api}>
      <PublicConfigContext value={{ ...SAMPLE_CONFIG, speech: true }}>
        <Section
          id="composer"
          title="Composer"
          description="The chat's message box. Its footer keeps one row: the effort drops first, then the context share and the mode's word, leaving icons."
        >
          <Example label="Full chat (704 px): the profile's mode, 2% used" wrap={false}>
            <Sample width={704}>{sampleComposerParts(20_400)}</Sample>
          </Example>
          <Example label="Full chat while a turn runs: Plan chosen for this chat, 76% used" wrap={false}>
            <Sample width={704} running>
              {sampleComposerParts(762_000, PLAN)}
            </Sample>
          </Example>
          <Example label="Phone (358 px) and the rail's docked chat (330 px)">
            <Sample width={358}>{sampleComposerParts(20_400)}</Sample>
            <Sample width={330}>{sampleComposerParts(20_400)}</Sample>
          </Example>
          <Example label="Docked chat while a turn runs, 93% used; and at 280 px">
            <Sample width={330} running>
              {sampleComposerParts(931_000, PLAN)}
            </Sample>
            <Sample width={280}>{sampleComposerParts(20_400)}</Sample>
          </Example>
        </Section>
      </PublicConfigContext>
    </ApiContext>
  );
}

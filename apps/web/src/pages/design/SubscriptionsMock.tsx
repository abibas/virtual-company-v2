import { useState } from 'react';
import { ApiContext } from '../../api/context.ts';
import type { LimitWindow, SubscriptionLimits } from '../../api/types.ts';
import { useLocation } from '../../app/router.tsx';
import { AddSubscriptionSheet } from '../../components/subscriptions/AddSubscriptionSheet.tsx';
import { LimitsWidget } from '../../components/subscriptions/LimitsWidget.tsx';
import { useAddSubscription } from '../../components/subscriptions/sign-in.ts';
import { MockShell } from './MockShell.tsx';
import { days, loaded, sampleApi } from './records.ts';

/** The gallery's day at 10:00, the time the "resets in" lines count from. */
const NOW = new Date(days(0)).getTime();
const MINUTE = 60_000;

/** An ISO time `minutes` from the gallery's "now". */
const inMinutes = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString();

const limitWindow = (
  id: LimitWindow['id'],
  usedPercent: number,
  resetsIn: number | null,
  reached = false,
): LimitWindow => ({
  id,
  label: id,
  usedPercent,
  resetsAt: resetsIn === null ? null : inMinutes(resetsIn),
  reached,
});

const entry = (
  n: number,
  fields: Pick<SubscriptionLimits, 'kind' | 'label' | 'accountEmail' | 'source' | 'windows'> &
    Partial<SubscriptionLimits>,
): SubscriptionLimits => ({
  credentialId: `c-${n}`,
  checkedAt: fields.source === 'none' ? null : inMinutes(-2),
  error: null,
  stale: false,
  ...fields,
});

/**
 * The sample limits: a healthy Claude login with its per-model windows, an OpenAI login at 85%, a setup-token whose
 * 5-hour limit is reached, a login whose last check was rate limited (stale), and an API key with no limits.
 */
const SAMPLE_LIMITS: readonly SubscriptionLimits[] = [
  entry(1, {
    kind: 'claude_oauth',
    label: 'Max at home',
    accountEmail: 'ihor@example.com',
    source: 'usage_api',
    windows: [
      limitWindow('five_hour', 18, 116),
      limitWindow('seven_day', 29, 6 * 24 * 60 + 450),
      limitWindow('seven_day_opus', 12, 6 * 24 * 60 + 450),
      limitWindow('seven_day_sonnet', 4, 6 * 24 * 60 + 450),
    ],
  }),
  entry(2, {
    kind: 'codex_oauth',
    label: 'OpenAI · ihor@example.com',
    accountEmail: 'ihor@example.com',
    source: 'usage_api',
    windows: [limitWindow('five_hour', 85, 42), limitWindow('weekly', 61, 4 * 24 * 60 + 90)],
  }),
  entry(3, {
    kind: 'claude_setup_token',
    label: 'Claude token for CI',
    accountEmail: null,
    source: 'message_headers',
    windows: [limitWindow('five_hour', 100, 130, true), limitWindow('seven_day', 47, 3 * 24 * 60)],
  }),
  entry(4, {
    kind: 'claude_oauth',
    label: 'Max on the devbox',
    accountEmail: 'ihor.work@example.com',
    source: 'usage_api',
    checkedAt: inMinutes(-41),
    error: { code: 'rate_limited', message: 'The provider rate limited the usage check. Try again later.' },
    stale: true,
    windows: [limitWindow('five_hour', 34, 75), limitWindow('seven_day', 52, 2 * 24 * 60 + 300)],
  }),
  entry(5, {
    kind: 'anthropic_api_key',
    label: 'Anthropic API key',
    accountEmail: null,
    source: 'none',
    windows: [],
  }),
];

const none = () => undefined;

/** The widget on sample limits, with the add sheet (every call refused: nothing is real here). */
function SampleWidget({ empty }: { readonly empty: boolean }) {
  const adding = useAddSubscription(none);
  return (
    <>
      <LimitsWidget
        limits={loaded({ limits: empty ? [] : [...SAMPLE_LIMITS] })}
        refreshing={false}
        onRefresh={none}
        manageHref="/design/subscriptions"
        onAdd={adding.choose}
        now={NOW}
      />
      <AddSubscriptionSheet adding={adding} onAdded={none} />
    </>
  );
}

/**
 * `/design/subscriptions`: the home page's Subscription limits widget on sample cards (healthy, 85%, reached, rate
 * limited and stale, an API key), so it can be reviewed before the first real sign-in; `?empty=1` shows it empty.
 */
export function SubscriptionsMock() {
  const { search } = useLocation();
  const [api] = useState(sampleApi);
  return (
    <ApiContext value={api}>
      <MockShell active="dashboard">
        <SampleWidget empty={search.get('empty') === '1'} />
      </MockShell>
    </ApiContext>
  );
}

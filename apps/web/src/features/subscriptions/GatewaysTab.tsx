import { Plus, Waypoints } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import {
  type SubscriptionCalls,
  subscriptionCalls,
  useAccessProfiles,
  useSubscriptions,
} from '../../api/subscriptions.ts';
import type { AccessProfile, Subscription } from '../../api/types.ts';
import { navigate, useLocation } from '../../app/router.tsx';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Sheet } from '../../components/layout/Drawer.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { GatewayCard } from './GatewayCard.tsx';
import { PasteForm, pasteTitle } from './PasteForm.tsx';
import type { TabHeader } from './SubscriptionsTab.tsx';

const SKELETON = (
  <div className="grid gap-4 md:grid-cols-2">
    <Skeleton className="h-44 rounded-2xl" />
    <Skeleton className="h-44 rounded-2xl max-md:hidden" />
  </div>
);

const WHAT_IT_IS =
  "An address your agents' AI requests go through, like your own proxy on port 8300: one gateway serves Claude Code " +
  'and Codex, each at its own path. Any profile’s Claude or OpenAI part can include it, and its runs then use it on any machine.';

/** The profiles whose gateway is `id`; undefined while the profiles load. */
const profilesWith = (profiles: readonly AccessProfile[] | undefined, id: string) =>
  profiles?.filter((profile) =>
    [profile.parts.claude, profile.parts.openai].some((part) => part?.gateway?.id === id),
  );

interface ListProps {
  readonly gateways: readonly Subscription[];
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly calls: SubscriptionCalls;
  /** A card renamed, edited or removed one: read the lists again. */
  readonly onChanged: () => void;
  readonly onAdd: () => void;
}

/** The cards, two across from md; the empty state, saying what a gateway is, with Add gateway. */
function GatewayList({ gateways, profiles, calls, onChanged, onAdd }: ListProps) {
  if (gateways.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Waypoints}
          tone="neutral"
          title="No AI gateways yet"
          action={
            <Button tone="primary" icon={Plus} onClick={onAdd}>
              Add gateway
            </Button>
          }
        >
          {WHAT_IT_IS}
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {gateways.map((gateway) => (
        <GatewayCard
          key={gateway.id}
          gateway={gateway}
          profiles={profilesWith(profiles, gateway.id)}
          rename={(label) => calls.rename(gateway.id, label).then(onChanged)}
          update={(changes) => calls.update(gateway.id, changes).then(onChanged)}
          remove={() => calls.remove(gateway.id).then(onChanged)}
        />
      ))}
    </div>
  );
}

/**
 * The AI gateways tab: the person's gateways (credentials of kind `gateway`) as cards, with the profiles that include
 * each, rename, edit and remove; Add gateway opens the gateway form in a sheet.
 * `addOnOpen` (`&add=1`, from a profile's Add a gateway) opens that sheet at once, and leaves the address without it. `header` puts Add gateway in the page's
 * header.
 */
export function GatewaysTab({
  addOnOpen = false,
  header,
}: {
  readonly addOnOpen?: boolean;
  readonly header?: TabHeader;
}) {
  const api = useApi();
  const calls = useMemo(() => subscriptionCalls(api), [api]);
  const subscriptions = useSubscriptions();
  const profiles = useAccessProfiles();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string>();
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!addOnOpen) return;
    setAdding(true);
    const rest = new URLSearchParams(search);
    rest.delete('add');
    navigate(rest.size > 0 ? `${pathname}?${rest}` : pathname, { replace: true });
  }, [addOnOpen, pathname, search]);
  const changed = () => {
    subscriptions.reload();
    profiles.reload();
  };
  const add = () => setAdding(true);
  const action: ReactNode = (
    <Button size="sm" tone="primary" icon={Plus} onClick={add}>
      Add gateway
    </Button>
  );
  return (
    <>
      {header ? (
        header(action)
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-sm text-dim">{WHAT_IT_IS}</p>
          {action}
        </div>
      )}
      {added && (
        <div className="mb-4">
          <Notice tone="success" onDismiss={() => setAdded(undefined)}>
            {added}
          </Notice>
        </div>
      )}
      <LoadState loaded={subscriptions} label="Loading your AI gateways…" skeleton={SKELETON}>
        {(data) => (
          <GatewayList
            gateways={data.subscriptions.filter((subscription) => subscription.kind === 'gateway')}
            profiles={profiles.data?.profiles}
            calls={calls}
            onChanged={changed}
            onAdd={add}
          />
        )}
      </LoadState>
      <AddGatewaySheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(gateway) => {
          setAdding(false);
          changed();
          setAdded(
            `${gateway.label} is added. Choose it as the gateway of a profile’s Claude or OpenAI part.`,
          );
        }}
      />
    </>
  );
}

/** Add gateway: the gateway form (its harness, address and headers) in a sheet beside the page; Back closes it. */
function AddGatewaySheet({
  open,
  onClose,
  onAdded,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAdded: (gateway: Subscription) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={pasteTitle('gateway')} description={WHAT_IT_IS}>
      {open && <PasteForm kind="gateway" onBack={onClose} onAdded={onAdded} />}
    </Sheet>
  );
}

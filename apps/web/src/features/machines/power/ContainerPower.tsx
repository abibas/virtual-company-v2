import { Power, PowerOff } from 'lucide-react';
import { useState } from 'react';
import type { PowerControl } from '../../../api/machines.ts';
import type { ContainerPower as ContainerPowerView, MachineLive, MachinePower } from '../../../api/types.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { CommandBox } from '../add/CommandBox.tsx';
import { BOX_STATUS } from '../card/machine-text.ts';
import {
  actionOf,
  type ContainerAction,
  type ContainerActions,
  containerLine,
  stopQuestion,
  useContainerActions,
} from './container-power.ts';

/**
 * A container runner's power on its card (docs/machines.md, "Starting and stopping a container"): Docker's state of its
 * container, Stop while it runs and Start while it does not (a Stop that would end chat turns or terminals asks first,
 * then forces), and without this server's own Docker the command to run instead of the click.
 */

/** The question before a Stop that ends live work. */
function ConfirmStop({
  question,
  onCancel,
  onStop,
}: {
  readonly question: string;
  readonly onCancel: () => void;
  readonly onStop: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the question cancels it.
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-failed-soft px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p className="text-sm font-medium text-ink">{question}</p>
      <Button size="sm" tone="quiet" onClick={onCancel} autoFocus>
        Cancel
      </Button>
      <Button size="sm" tone="danger" icon={PowerOff} onClick={onStop}>
        Stop anyway
      </Button>
    </div>
  );
}

/** Start or Stop for the container's state; `onCommand` instead of the call when this server has no Docker. */
export function ContainerStartStop({
  container,
  live,
  actions,
  onCommand,
}: {
  readonly container: ContainerPowerView;
  readonly live: MachineLive | undefined;
  readonly actions: ContainerActions;
  readonly onCommand: (action: ContainerAction) => void;
}) {
  const [asking, setAsking] = useState(false);
  const action = actionOf(container);
  const question = stopQuestion(live);
  if (asking && question !== undefined) {
    return (
      <ConfirmStop
        question={question}
        onCancel={() => setAsking(false)}
        onStop={() => {
          setAsking(false);
          actions.run('stop', true);
        }}
      />
    );
  }
  const click = () => {
    if (!container.docker) onCommand(action);
    else if (action === 'stop' && question !== undefined) setAsking(true);
    else actions.run(action);
  };
  return (
    <Button
      size="sm"
      tone={action === 'start' ? 'primary' : 'secondary'}
      icon={action === 'start' ? Power : PowerOff}
      busy={actions.busy === action}
      disabled={actions.busy !== undefined || container.status === 'stopping'}
      title={container.docker ? undefined : 'Shows the command to run on the computer running Docker'}
      onClick={click}
    >
      {action === 'start' ? 'Start' : 'Stop'}
    </Button>
  );
}

/** A command to run by hand, with where. */
function ByHand({ command, hint }: { readonly command: string; readonly hint: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-dim">{hint}</p>
      <CommandBox command={command} />
    </div>
  );
}

const HINTS: Readonly<Record<ContainerAction, string>> = {
  start: 'Run this in a Terminal on the computer running Docker to start the container:',
  stop: 'Run this in a Terminal on the computer running Docker to stop the container (its runner shuts down first):',
};

/**
 * What follows a Start or Stop: the command to run (`shown`, without this server's Docker), the one that creates a
 * missing container again, and a refusal with the command it names.
 */
export function ContainerOutcome({
  container,
  actions,
  shown,
}: {
  readonly container: ContainerPowerView;
  readonly actions: ContainerActions;
  readonly shown: ContainerAction | undefined;
}) {
  return (
    <>
      {!container.docker && shown && <ByHand command={container.commands[shown]} hint={HINTS[shown]} />}
      {container.status === 'missing' && !actions.failure && (
        <ByHand
          command={container.commands.create}
          hint="No container of this runner was found. This creates it again (its volumes keep its enrollment) at the default CPUs and memory: change them first if it had others."
        />
      )}
      {actions.failure && (
        <>
          <Notice tone="error" onDismiss={actions.dismiss}>
            {actions.failure.message}
          </Notice>
          {actions.failure.command && <CommandBox command={actions.failure.command} />}
        </>
      )}
    </>
  );
}

/** Which command is shown, toggled by the button while this server has no Docker. */
export function useShownCommand() {
  const [shown, setShown] = useState<ContainerAction>();
  const toggle = (action: ContainerAction) => setShown((was) => (was === action ? undefined : action));
  return { shown, toggle };
}

/** The container's power part: its state, Start or Stop, who does it, and any refusal with its command. */
export function ContainerPower({
  power,
  control,
  live,
}: {
  readonly power: MachinePower;
  readonly control: PowerControl;
  readonly live: MachineLive | undefined;
}) {
  const actions = useContainerActions(control);
  const { shown, toggle } = useShownCommand();
  const container = power.container;
  if (!container) return null;
  const [words, tone] = BOX_STATUS[container.status];
  return (
    <section aria-label="The container" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone} dot>
          Container {words.toLowerCase()}
        </Badge>
        <span className="flex-1" />
        {power.canControl && (
          <ContainerStartStop container={container} live={live} actions={actions} onCommand={toggle} />
        )}
      </div>
      <p className="text-xs text-dim">{containerLine(container)}</p>
      {container.error && <Notice tone="warning">{container.error}</Notice>}
      <ContainerOutcome container={container} actions={actions} shown={shown} />
    </section>
  );
}

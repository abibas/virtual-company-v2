import { MODEL_CATALOGUE } from '@mwc/shared/models';
import { MODES } from '@mwc/shared/modes';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../../components/cx.ts';
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  type MenuTriggerProps,
} from '../../../components/forms/Menu.tsx';
import { useAction } from '../use-action.ts';
import { MODE_ICON } from './mode-icons.ts';
import {
  effortChoices,
  effortWords,
  modelPatch,
  modelWords,
  modeWords,
  type OverridesPatch,
  type RunsView,
} from './runs-state.ts';

/**
 * A pill in the composer's footer: an icon (the Mode's), the current choice and an arrow; blue while the chat overrides
 * its profile. Its label and the muted suffix hide by the composer's width (`labelClass`, `suffixClass`: container
 * queries on the card), its full words stay in its tooltip and its accessible name.
 */
function Pill({
  props,
  icon: Icon,
  label,
  labelClass,
  suffix,
  suffixClass,
  name,
  overridden,
  disabled,
}: {
  readonly props: MenuTriggerProps;
  readonly icon?: LucideIcon;
  readonly label: string;
  readonly labelClass?: string;
  readonly suffix?: string;
  readonly suffixClass?: string;
  /** The full words: "Mode: Skip prompts (full trust)". */
  readonly name: string;
  readonly overridden: boolean;
  readonly disabled: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      title={name}
      aria-label={name}
      disabled={disabled}
      className={cx(
        'inline-flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-60 aria-expanded:bg-surface-2',
        overridden ? 'text-blue' : 'text-dim hover:text-ink-2',
      )}
    >
      {Icon && <Icon size={15} strokeWidth={2.25} aria-hidden="true" className="shrink-0" />}
      <span className={cx('min-w-0 truncate', labelClass)}>
        {label}
        {suffix && (
          <span className={cx('font-medium', overridden ? 'text-blue/70' : 'text-faint', suffixClass)}>
            {` · ${suffix}`}
          </span>
        )}
      </span>
      <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" className="shrink-0 opacity-70" />
    </button>
  );
}

/** The Mode pill's words show from a 24rem composer; below, its icon alone. */
const MODE_LABEL = 'hidden @sm/composer:inline';
/** The model's effort, the first to go: from a 32rem composer. */
const EFFORT_SUFFIX = 'hidden @lg/composer:inline';

interface MenuProps {
  readonly view: RunsView;
  readonly busy: boolean;
  readonly change: (patch: OverridesPatch) => void;
}

/** Reset to profile: the chat's own choices in this menu cleared. */
function Reset({ shown, onSelect }: { readonly shown: boolean; readonly onSelect: () => void }) {
  if (!shown) return null;
  return (
    <>
      <MenuSeparator />
      <MenuItem tone="accent" onSelect={onSelect}>
        Reset to profile
      </MenuItem>
    </>
  );
}

/** The Mode menu: the profile's, then each of the harness's modes with its line, as Claude's own mode menu. */
function ModeMenu({ view, busy, change }: MenuProps) {
  const { provider, profile, overrides, next } = view;
  const profiles = `Profile's (${modeWords(provider, profile.mode)})`;
  const name = overrides.mode === null ? `Mode: ${profiles}` : `Mode: ${modeWords(provider, next.mode)}`;
  return (
    <Menu
      floating
      side="above"
      width="w-72"
      trigger={(props) => (
        <Pill
          props={props}
          icon={MODE_ICON[next.mode]}
          label={modeWords(provider, next.mode, true)}
          labelClass={MODE_LABEL}
          name={name}
          overridden={overrides.mode !== null}
          disabled={busy}
        />
      )}
    >
      <MenuLabel>Mode</MenuLabel>
      <MenuItem current={overrides.mode === null} onSelect={() => change({ mode: null })}>
        {profiles}
      </MenuItem>
      <MenuSeparator />
      {MODES[provider].map((mode) => (
        <MenuItem
          key={mode.id}
          current={overrides.mode === mode.id}
          description={mode.description}
          onSelect={() => change({ mode: mode.id })}
        >
          {mode.label}
        </MenuItem>
      ))}
      <Reset shown={overrides.mode !== null} onSelect={() => change({ mode: null })} />
    </Menu>
  );
}

/** The Model menu: the profile's, then the provider's catalogue; the effort under it, as a sub-choice. */
function ModelMenu({ view, busy, change }: MenuProps) {
  const { provider, profile, overrides, next } = view;
  const model = modelWords(provider, next.model);
  const overridden = overrides.model !== null || overrides.effort !== null;
  return (
    <Menu
      floating
      side="above"
      width="w-64"
      trigger={(props) => (
        <Pill
          props={props}
          label={model}
          suffix={effortWords(next.effort)}
          suffixClass={EFFORT_SUFFIX}
          name={`Model: ${model} · ${effortWords(next.effort)}`}
          overridden={overridden}
          disabled={busy}
        />
      )}
    >
      <MenuLabel>Model</MenuLabel>
      <MenuItem current={overrides.model === null} onSelect={() => change(modelPatch(view, null))}>
        Profile's ({modelWords(provider, profile.model)})
      </MenuItem>
      {MODEL_CATALOGUE[provider].map((choice) => (
        <MenuItem
          key={choice.id}
          current={overrides.model === choice.id}
          onSelect={() => change(modelPatch(view, choice.id))}
        >
          {choice.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuLabel>Effort</MenuLabel>
      <MenuItem current={overrides.effort === null} onSelect={() => change({ effort: null })}>
        Profile's ({effortWords(profile.effort)})
      </MenuItem>
      {effortChoices(view).map((effort) => (
        <MenuItem key={effort} current={overrides.effort === effort} onSelect={() => change({ effort })}>
          {effortWords(effort)}
        </MenuItem>
      ))}
      <Reset shown={overridden} onSelect={() => change({ model: null, effort: null })} />
    </Menu>
  );
}

/**
 * The composer's Mode and Model menus (2026-11-13): the chat's own mode, model and effort for its next turns, each
 * marked as the profile's until changed; a change is saved at once (a running turn keeps what it started with), and a
 * refusal shows beside them. The menus open upward. By the composer's width (its card is the `composer` container):
 * the model's effort shows from 32rem, the mode's short label from 24rem, its icon always.
 */
export function RunsMenus({
  view,
  onChange,
}: {
  readonly view: RunsView;
  readonly onChange: (patch: OverridesPatch) => Promise<unknown>;
}): ReactNode {
  const { busy, error, run } = useAction();
  const change = (patch: OverridesPatch) => void run(() => onChange(patch));
  const menus = { view, busy, change };
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <ModeMenu {...menus} />
      <ModelMenu {...menus} />
      {error && (
        <span role="alert" title={error} className="ml-1 min-w-0 truncate text-2xs font-medium text-failed">
          {error}
        </span>
      )}
    </div>
  );
}

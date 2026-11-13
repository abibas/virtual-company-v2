import { MODEL_CATALOGUE } from '@mwc/shared/models';
import { MODES } from '@mwc/shared/modes';
import { ChevronDown } from 'lucide-react';
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
import {
  effortChoices,
  effortWords,
  modelPatch,
  modelWords,
  modeWords,
  type OverridesPatch,
  type RunsView,
} from './runs-state.ts';

/** A pill in the composer's footer: the current choice and an arrow; blue while the chat overrides its profile. */
function Pill({
  props,
  label,
  title,
  overridden,
  disabled,
}: {
  readonly props: MenuTriggerProps;
  readonly label: string;
  readonly title: string;
  readonly overridden: boolean;
  readonly disabled: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      title={title}
      disabled={disabled}
      className={cx(
        'inline-flex h-8 max-w-40 min-w-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60',
        overridden ? 'text-blue' : 'text-dim',
      )}
    >
      <span className="truncate">{label}</span>
      <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
    </button>
  );
}

interface MenuProps {
  readonly view: RunsView;
  readonly dense: boolean;
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
function ModeMenu({ view, dense, busy, change }: MenuProps) {
  const { provider, profile, overrides, next } = view;
  const profiles = `Profile's (${modeWords(provider, profile.mode)})`;
  return (
    <Menu
      floating
      side="above"
      width="w-72"
      trigger={(props) => (
        <Pill
          props={props}
          label={modeWords(provider, next.mode, dense)}
          title={overrides.mode === null ? `Mode: ${profiles}` : `Mode: ${modeWords(provider, next.mode)}`}
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
function ModelMenu({ view, dense, busy, change }: MenuProps) {
  const { provider, profile, overrides, next } = view;
  const model = modelWords(provider, next.model);
  const label = dense ? model : `${model} · ${effortWords(next.effort)}`;
  const overridden = overrides.model !== null || overrides.effort !== null;
  return (
    <Menu
      floating
      side="above"
      width="w-64"
      trigger={(props) => (
        <Pill
          props={props}
          label={label}
          title={`Model: ${model} · ${effortWords(next.effort)}`}
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
 * refusal shows beside them. Short labels in the docked chat, and the menus open upward.
 */
export function RunsMenus({
  view,
  dense = false,
  onChange,
}: {
  readonly view: RunsView;
  readonly dense?: boolean;
  readonly onChange: (patch: OverridesPatch) => Promise<unknown>;
}): ReactNode {
  const { busy, error, run } = useAction();
  const change = (patch: OverridesPatch) => void run(() => onChange(patch));
  const menus = { view, dense, busy, change };
  return (
    <div className="flex min-w-0 items-center">
      <ModeMenu {...menus} />
      <ModelMenu {...menus} />
      {error && (
        <span role="alert" title={error} className="ml-1 max-w-40 truncate text-2xs font-medium text-failed">
          {error}
        </span>
      )}
    </div>
  );
}

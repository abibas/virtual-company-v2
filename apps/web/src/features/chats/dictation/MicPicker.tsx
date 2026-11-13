import { ChevronDown } from 'lucide-react';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../../components/forms/Menu.tsx';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import type { MicChoice } from './mics.ts';

/**
 * The arrow beside the microphone button: the default microphone or one of the inputs, listed again each time it opens;
 * a chosen one that is not connected shows as such (the default one is used meanwhile).
 */
export function MicPicker({
  mics,
  mic,
  disabled,
  onOpen,
  onChoose,
}: {
  readonly mics: readonly MicChoice[];
  readonly mic: MicChoice | null;
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onChoose: (choice: MicChoice | null) => void;
}) {
  const missing = mic !== null && !mics.some((input) => input.deviceId === mic.deviceId) ? mic : null;
  return (
    <Menu
      align="end"
      floating
      trigger={(props) => (
        <IconButton
          {...props}
          onClick={() => {
            props.onClick();
            onOpen();
          }}
          label="Microphone"
          icon={ChevronDown}
          size="sm"
          className="w-5 rounded-full"
          disabled={disabled}
        />
      )}
    >
      <MenuLabel>Microphone</MenuLabel>
      <MenuSeparator />
      <MenuItem current={mic === null} onSelect={() => onChoose(null)}>
        Default microphone
      </MenuItem>
      {mics.map((input, index) => (
        <MenuItem
          key={input.deviceId}
          current={mic?.deviceId === input.deviceId}
          onSelect={() => onChoose(input)}
        >
          {input.label || `Microphone ${index + 1}`}
        </MenuItem>
      ))}
      {missing && (
        <MenuItem current disabled description="Not connected: the default one is used">
          {missing.label || 'Chosen microphone'}
        </MenuItem>
      )}
    </Menu>
  );
}

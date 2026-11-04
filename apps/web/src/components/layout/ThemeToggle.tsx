import { Moon, Sun } from 'lucide-react';
import { useThemeChoice } from '../../app/theme.ts';
import { IconButton, type IconButtonSize, type IconButtonTone } from '../ui/IconButton.tsx';
import type { TooltipSide } from '../ui/Tooltip.tsx';

/** Flips between light and dark (the system's choice until the first flip). */
export function ThemeToggle({
  tone = 'ghost',
  size = 'md',
  tooltip,
}: {
  readonly tone?: IconButtonTone;
  readonly size?: IconButtonSize;
  readonly tooltip?: TooltipSide;
}) {
  const { resolved, toggle } = useThemeChoice();
  const dark = resolved === 'dark';
  return (
    <IconButton
      label={dark ? 'Switch to light' : 'Switch to dark'}
      icon={dark ? Sun : Moon}
      tone={tone}
      size={size}
      onClick={toggle}
      {...(tooltip ? { tooltip } : {})}
    />
  );
}

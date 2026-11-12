import { Network } from 'lucide-react';
import { Link } from '../../../app/router.tsx';
import { iconButtonClass, iconSize } from '../../../components/ui/IconButton.tsx';
import { Tooltip, type TooltipSide } from '../../../components/ui/Tooltip.tsx';

/** "Show on org chart": an icon link to the org chart with a flow's members highlighted (`chartWithFlow`). */
export function ShowOnChart({
  href,
  side = 'bottom',
}: {
  readonly href: string;
  readonly side?: TooltipSide;
}) {
  return (
    <Tooltip label="Show on org chart" side={side}>
      <Link to={href} aria-label="Show on org chart" className={iconButtonClass({ size: 'sm' })}>
        <Network size={iconSize('sm')} strokeWidth={2} aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

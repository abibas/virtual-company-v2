import { type ReactNode, useRef } from 'react';
import { Card } from '../../components/ui/Card.tsx';
import { useFillViewport } from '../chats/use-fill-viewport.ts';

/** The window's bottom gap under the frame, as the chat page keeps it. */
const BOTTOM_GAP = 16;

/**
 * The team page's Team chat tab: a card that ends just above the window's bottom on every screen, so only the room's
 * feed scrolls and its message box stays in view.
 */
export function RoomFrame({ children }: { readonly children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const height = useFillViewport(frame, BOTTOM_GAP, 0);
  return (
    <Card
      ref={frame}
      padding="none"
      className="flex min-h-[28rem] flex-col pt-3 font-reading"
      style={height === undefined ? undefined : { height }}
    >
      {children}
    </Card>
  );
}

import type { ReactNode } from 'react';
import { RequesterLinks } from './RequesterLinks.tsx';
import { RequestersColumn } from './RequestersColumn.tsx';
import type { RequesterLayer } from './use-requester-layer.ts';
import type { ChartRequesters } from './use-requesters.ts';

/** The chart's own layer (`children`) between the Requesters' links, under every card, and their column beside it. */
export function WithRequesters({
  layer,
  requesters,
  children,
}: {
  readonly layer: RequesterLayer;
  readonly requesters: ChartRequesters | undefined;
  readonly children: ReactNode;
}) {
  const { layout, lit } = layer;
  return (
    <>
      {layout && <RequesterLinks links={layout.links} width={layer.width} height={layer.height} lit={lit} />}
      {children}
      {layout && requesters && (
        <RequestersColumn
          layout={layout}
          range={requesters.window}
          lit={lit}
          contactHref={requesters.contactHref}
          moreHref={requesters.moreHref}
          onHover={layer.setHover}
        />
      )}
    </>
  );
}

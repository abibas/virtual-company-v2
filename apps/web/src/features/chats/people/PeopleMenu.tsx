import { Ellipsis, Users } from 'lucide-react';
import { useState } from 'react';
import type { ChartNode, ChatPerson } from '../../../api/types.ts';
import { Menu, MenuItem } from '../../../components/forms/Menu.tsx';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { iconButtonClass } from '../../../components/ui/IconButton.tsx';
import { ChatFaces } from './ChatFaces.tsx';
import { type PeopleActions, PeopleSheet } from './PeopleSheet.tsx';

/**
 * The open chat's ⋯ menu (2026-11-14): People in this chat, with their faces, which opens the People sheet. Shown for
 * a message chat (a task's conversation and a team chat keep their own rules).
 */
export function PeopleMenu({
  people,
  nodes,
  reader,
  looksOn,
  actions,
}: {
  readonly people: readonly ChatPerson[];
  readonly nodes: readonly ChartNode[] | undefined;
  readonly reader: { readonly principalId: string | undefined; readonly owner: boolean };
  readonly looksOn: boolean;
  readonly actions: PeopleActions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Menu
        align="end"
        width="w-60"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label="More"
            title="More"
            className={iconButtonClass({ tone: 'ghost', size: 'sm' })}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
        )}
      >
        <MenuItem
          icon={Users}
          trailing={<ChatFaces people={people} max={3} />}
          onSelect={() => setOpen(true)}
        >
          People in this chat
        </MenuItem>
      </Menu>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="People in this chat"
        description="Only the people here see this chat; company owners can read any chat."
      >
        <PeopleSheet people={people} nodes={nodes} reader={reader} looksOn={looksOn} actions={actions} />
      </Sheet>
    </>
  );
}

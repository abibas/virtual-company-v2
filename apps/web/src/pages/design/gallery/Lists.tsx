import { Inbox, KeyRound, Mail } from 'lucide-react';
import { useState } from 'react';
import { type Column, DataTable, Primary } from '../../../components/data/DataTable.tsx';
import { DayGroup } from '../../../components/data/DayGroup.tsx';
import { groupByDay } from '../../../components/data/days.ts';
import { formatDate } from '../../../components/data/format.ts';
import { List, ListRow } from '../../../components/data/List.tsx';
import { AttentionRow } from '../../../components/feed/AttentionRow.tsx';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { Avatar } from '../../../components/ui/Avatar.tsx';
import { roleName, StatusPill } from '../../../components/ui/Badge.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import { SkeletonRow, SkeletonText } from '../../../components/ui/Skeleton.tsx';
import { InboxView } from '../../../features/inbox/InboxView.tsx';
import { QuickTask } from '../../../features/inbox/QuickTask.tsx';
import { SAMPLE_INBOX, SAMPLE_TEAMS } from '../inbox-sample.ts';
import { SAMPLE_COMPANY } from '../records.ts';
import { SAMPLE_ATTENTION, SAMPLE_NOW, SAMPLE_PEOPLE, type SamplePerson } from '../sample.ts';
import { Example, Section } from './Section.tsx';

const COLUMNS: readonly Column<SamplePerson>[] = [
  {
    key: 'person',
    header: 'Person',
    cell: (p) => (
      <div className="flex items-start gap-2.5">
        <Avatar name={p.name} size="sm" />
        <Primary title={p.name} subtitle={p.email} phone={<StatusPill status={p.status} size="sm" />} />
      </div>
    ),
  },
  { key: 'role', header: 'Role', cell: (p) => roleName(p.role) },
  { key: 'status', header: 'Status', hide: 'md', cell: (p) => <StatusPill status={p.status} /> },
  { key: 'joined', header: 'Joined', hide: 'md', cell: (p) => formatDate(p.joinedAt) },
  {
    key: 'actions',
    header: 'Actions',
    srOnly: true,
    align: 'right',
    cell: (p) => (
      <ConfirmInline
        label="Remove"
        question={`Remove ${p.name}?`}
        confirmLabel="Remove"
        onConfirm={() => Promise.resolve()}
      />
    ),
  },
];

function RowsAndFeed() {
  return (
    <>
      <Example label="ListRow: tile, title, subtitle, value, meta" wrap={false}>
        <List divided className="max-w-lg">
          <ListRow
            icon={KeyRound}
            tone="teal"
            title="laptop"
            subtitle="mwc_pk_AbCd…"
            value="Active"
            valueTone="done"
            meta="Expires in 82 days"
          />
          <ListRow
            icon={Mail}
            tone="input"
            title="theo@example.com"
            subtitle="Member"
            value="Pending"
            valueTone="input"
            meta="Expires in 12 days"
            href="#lists"
          />
          <ListRow
            leading={<Avatar name="Olena Marsh" />}
            title="Olena Marsh"
            subtitle="olena@example.com"
            trailing={<Button size="sm">Message</Button>}
          />
        </List>
      </Example>
      <Example label="The attention feed, every kind, by day" wrap={false}>
        <div className="max-w-lg">
          {groupByDay(SAMPLE_ATTENTION, (item) => item.at, SAMPLE_NOW).map((group) => (
            <DayGroup key={group.label} label={group.label}>
              <List>
                {group.items.map((item) => (
                  <AttentionRow key={item.id} item={item} />
                ))}
              </List>
            </DayGroup>
          ))}
        </div>
      </Example>
      <Example label="DataTable (columns hide below md; the first cell shows the essentials)" wrap={false}>
        <DataTable columns={COLUMNS} rows={SAMPLE_PEOPLE} rowKey={(p) => p.id} />
      </Example>
    </>
  );
}

function StatesAndNotices() {
  return (
    <Example label="EmptyState, Skeleton, Notice" className="grid gap-4 lg:grid-cols-2" wrap={false}>
      <EmptyState
        icon={Inbox}
        tone="blue"
        title="Nothing needs you right now"
        action={<Button size="sm">Create a task</Button>}
      >
        Questions, blockers and reviews from your agents land here.
      </EmptyState>
      <div className="flex flex-col gap-3">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonText lines={2} />
      </div>
      <div className="flex flex-col gap-2 lg:col-span-2">
        <Notice tone="info">This company is being set up with the sign-in service.</Notice>
        <Notice tone="success" title="Invitation sent">
          theo@example.com gets an email with a link that signs them up and adds them here.
        </Notice>
        <Notice tone="warning" onDismiss={() => undefined}>
          Your key expires in 3 days.
        </Notice>
        <Notice tone="error" action={<Button size="sm">Try again</Button>}>
          The server could not be reached.
        </Notice>
      </div>
    </Example>
  );
}

function InboxExample() {
  const [sent, setSent] = useState<string>();
  return (
    <Example label="The inbox: every kind as a card, and the quick-create dock (sample only)" wrap={false}>
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <InboxView
          items={SAMPLE_INBOX}
          loading={false}
          failed={false}
          companyId={SAMPLE_COMPANY.id}
          onAct={async (item, move) => setSent(`${move.action} ${item.task?.key ?? item.title}`)}
          onAnswer={async (_, answers) =>
            setSent(`answered ${answers.map((a) => a.picked.join('+')).join(', ')}`)
          }
        />
        <div className="flex flex-col gap-2">
          <QuickTask
            teams={SAMPLE_TEAMS}
            companyId={SAMPLE_COMPANY.id}
            onCreate={async (team, title) => {
              setSent(`${team.flowName}: ${title}`);
              return { key: 'T-30', where: team.leads ? 'at Develop' : 'queued' };
            }}
            taskHref={() => '/design/flows'}
            flowsHref="/design/flows"
          />
          {sent && (
            <p role="status" className="text-xs text-dim">
              Sample only; would send “{sent}”.
            </p>
          )}
        </div>
      </div>
    </Example>
  );
}

export function ListsSection() {
  return (
    <Section
      id="lists"
      title="List, DayGroup, DataTable, feed"
      description="Every list is ListRows; every table of records is a DataTable. The feed is the same rows grouped by day."
    >
      <RowsAndFeed />
      <StatesAndNotices />
      <InboxExample />
    </Section>
  );
}

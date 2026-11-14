import { CONTACT_NOTE_MAX } from '@mwc/shared/contacts';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useState } from 'react';
import type { Contact, ContactChange } from '../../api/contacts.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { Textarea } from '../../components/forms/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

/**
 * A contact's note and archive (2026-11-14, docs/subscriptions.md "Contacts"): admins and owners write the note (Save;
 * blank removes it) and archive or bring back the contact; everyone else reads the note, and sees nothing without one.
 */
export function ContactNote({
  contact,
  admin,
  onChange,
}: {
  readonly contact: Contact;
  readonly admin: boolean;
  /** Saves a change; resolves with the contact as it is now. */
  readonly onChange: (change: ContactChange) => Promise<Contact>;
}) {
  const [draft, setDraft] = useState(contact.note ?? '');
  const [busy, setBusy] = useState<'note' | 'archive'>();
  const [error, setError] = useState<string>();
  const save = async (what: 'note' | 'archive', change: ContactChange) => {
    setBusy(what);
    setError(undefined);
    try {
      const saved = await onChange(change);
      setDraft(saved.note ?? '');
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(undefined);
    }
  };
  if (!admin) {
    if (contact.note === null) return null;
    return (
      <Panel title="Note" padding="sm">
        <p className="text-sm whitespace-pre-wrap text-ink-2">{contact.note}</p>
      </Panel>
    );
  }
  const archived = contact.archivedAt !== null;
  return (
    <Panel
      title="Note"
      padding="sm"
      actions={
        <Button
          size="sm"
          tone="quiet"
          icon={archived ? ArchiveRestore : Archive}
          busy={busy === 'archive'}
          onClick={() => void save('archive', { archived: !archived })}
        >
          {archived ? 'Bring back' : 'Archive'}
        </Button>
      }
    >
      <div className="grid gap-2">
        <Textarea
          aria-label={`Note on ${contact.name}`}
          value={draft}
          maxLength={CONTACT_NOTE_MAX}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p role="alert" className="text-xs font-medium text-failed">
              {error}
            </p>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            tone="soft"
            busy={busy === 'note'}
            disabled={draft.trim() === (contact.note ?? '')}
            onClick={() => void save('note', { note: draft })}
          >
            Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

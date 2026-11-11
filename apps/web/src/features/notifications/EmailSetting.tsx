import { useState } from 'react';
import { useNotificationSettings } from '../../api/notifications.ts';
import { Switch } from '../../components/forms/Switch.tsx';

/** What the email switch says about this server's email (MWC_EMAIL). */
const SERVER_EMAIL = {
  outbox: 'This development server writes emails to its outbox instead of sending them.',
  smtp: null,
  off: 'Email is off on this server, so none go out for now.',
} as const;

/** The switch at the foot of the notifications and its note, drawn from props (the gallery's too). */
export function EmailSwitch({
  checked,
  onChange,
  disabled = false,
  note,
}: {
  readonly checked: boolean;
  readonly onChange: (email: boolean) => void;
  readonly disabled?: boolean;
  readonly note: string;
}) {
  return (
    <div className="border-t border-line px-2.5 pt-3 pb-1.5">
      <Switch checked={checked} onChange={onChange} disabled={disabled} label="Email me these" />
      <p className="mt-1.5 text-xs text-dim">{note}</p>
    </div>
  );
}

/** The person's email setting here, live: on by default, saved at once; with a note when this server sends none. */
export function EmailSetting({ companyId }: { readonly companyId: string }) {
  const { settings, save } = useNotificationSettings(companyId);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!settings) return null;
  const change = (email: boolean) => {
    setSaving(true);
    setFailed(false);
    save(email)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };
  const note = failed
    ? 'That did not save. Try again.'
    : (SERVER_EMAIL[settings.serverEmail] ?? 'A minute of changes goes out as one short email.');
  return <EmailSwitch checked={settings.email} onChange={change} disabled={saving} note={note} />;
}

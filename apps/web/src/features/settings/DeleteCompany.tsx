import { useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import { TextField } from '../../components/forms/Field.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

/** Delete the company (owners only), confirmed by typing its exact name; the server checks the name again. */
export function DeleteCompany({
  companyId,
  name,
  onDeleted,
}: {
  readonly companyId: string;
  readonly name: string;
  readonly onDeleted: () => void;
}) {
  const api = useApi();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const matches = typed.trim() === name;

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await call(
        api.api.companies[':companyId'].$delete({ param: { companyId }, json: { confirmName: typed } }),
      );
      onDeleted();
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Panel
      tone="danger"
      title="Delete this company"
      description="Everyone loses access at once, invitations stop working and every API key of the company is refused. There is no undo in the app."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (matches) void remove();
        }}
        className="flex flex-col gap-3"
      >
        <TextField
          label={`Type “${name}” to confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="sm:max-w-sm"
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <Button type="submit" tone="danger" busy={busy} disabled={!matches}>
            Delete company
          </Button>
        </div>
      </form>
    </Panel>
  );
}

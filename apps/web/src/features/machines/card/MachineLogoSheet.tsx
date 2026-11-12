import { useState } from 'react';
import { useApi } from '../../../api/context.ts';
import { friendlyMessage } from '../../../api/errors.ts';
import { removeMachineLogo, uploadMachineLogo, useMachineLogo } from '../../../api/images/machine-logo.ts';
import { LogoPicker } from '../../../components/forms/image/LogoPicker.tsx';
import { type PreparedLogo, releaseLogo } from '../../../components/forms/image/logo-file.ts';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { Notice } from '../../../components/ui/Notice.tsx';
import type { MachineMark } from './MachineLogo.tsx';

const HINT =
  'PNG, JPEG or WebP, up to 10 MB; cropped square and scaled to 512 pixels. Click, drop a file, or paste an image.';

/** A crop is saved at once; while it is, the picker shows it, and then the result or the refusal. */
function useLogoChange(onUpload: (logo: PreparedLogo) => Promise<void>) {
  const [pending, setPending] = useState<PreparedLogo | null>(null);
  const [result, setResult] = useState<{ readonly ok: boolean; readonly text: string }>();
  const change = async (logo: PreparedLogo | null) => {
    if (!logo) {
      releaseLogo(pending);
      setPending(null);
      return;
    }
    setPending(logo);
    setResult(undefined);
    try {
      await onUpload(logo);
      setResult({ ok: true, text: 'Logo saved.' });
    } catch (failure) {
      setResult({ ok: false, text: friendlyMessage(failure) });
    } finally {
      releaseLogo(logo);
      setPending(null);
    }
  };
  return { pending, result, change, dismiss: () => setResult(undefined) };
}

/** The machine's logo, changed in a sheet as the company's is on Settings: pick, crop and upload, or remove it. */
export function MachineLogoSheet({
  mark,
  open,
  onClose,
  onChanged,
}: {
  readonly mark: MachineMark;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const { companyId, machineId } = mark;
  const src = useMachineLogo(companyId, machineId, mark.logoVersion);
  const logo = useLogoChange(async (picked) => {
    await uploadMachineLogo(api, companyId, machineId, picked.blob);
    onChanged();
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${mark.name}: logo`}
      description="Shown on its card and on the home board, in place of its kind icon."
    >
      <div className="flex flex-col gap-4">
        <LogoPicker
          kind="machine"
          name={mark.name}
          label={src ? 'Current logo' : 'No logo yet: its kind icon stands in'}
          src={src}
          value={logo.pending}
          onChange={logo.change}
          onRemove={async () => {
            await removeMachineLogo(api, companyId, machineId);
            onChanged();
          }}
          busy={logo.pending !== null}
          hint={HINT}
        />
        {logo.result && (
          <Notice tone={logo.result.ok ? 'success' : 'error'} onDismiss={logo.dismiss}>
            {logo.result.text}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

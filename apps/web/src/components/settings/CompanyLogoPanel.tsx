import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { LogoPicker } from '../forms/LogoPicker.tsx';
import { type PreparedLogo, releaseLogo } from '../forms/logo-file.ts';
import { CompanyLogo } from '../ui/CompanyLogo.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Panel } from '../ui/Panel.tsx';

interface CompanyLogoPanelProps {
  readonly name: string;
  /** The saved logo (an object URL), if any. */
  readonly logoSrc: string | null | undefined;
  /** Admins and owners change it; everyone else sees it. */
  readonly canChange: boolean;
  readonly onUpload: (logo: PreparedLogo) => Promise<void>;
  readonly onRemove: () => Promise<void>;
}

const HINT =
  'PNG, JPEG or WebP, up to 10 MB; it is scaled to 512 pixels. Click, drop a file, or paste an image.';

/** A pick is saved at once; while it is, the picker shows it, and then the result or the refusal. */
function useLogoChange(onUpload: CompanyLogoPanelProps['onUpload']) {
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

/** The company's logo on Settings: change or remove it (admins and owners), or see it. */
export function CompanyLogoPanel({ name, logoSrc, canChange, onUpload, onRemove }: CompanyLogoPanelProps) {
  const logo = useLogoChange(onUpload);
  return (
    <Panel
      title="Company logo"
      description="Shown in the rail, in the company switcher and on the overview, beside the name."
    >
      {canChange ? (
        <div className="flex flex-col gap-4">
          <LogoPicker
            name={name}
            label={logoSrc ? 'Current logo' : 'No logo yet: the initials stand in'}
            src={logoSrc}
            value={logo.pending}
            onChange={logo.change}
            onRemove={onRemove}
            busy={logo.pending !== null}
            hint={HINT}
          />
          {logo.result && (
            <Notice tone={logo.result.ok ? 'success' : 'error'} onDismiss={logo.dismiss}>
              {logo.result.text}
            </Notice>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <CompanyLogo name={name} src={logoSrc} size="xl" />
          <p className="text-sm text-dim">
            {logoSrc
              ? 'Admins and owners change it.'
              : 'No logo yet: the company shows its initials. Admins and owners add one.'}
          </p>
        </div>
      )}
    </Panel>
  );
}

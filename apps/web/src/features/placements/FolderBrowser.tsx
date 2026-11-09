import { ArrowUp, Check, ChevronRight, FileText, Folder, FolderGit2, FolderPlus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { type FolderBrowserState, useFolderBrowser } from '../../api/folders.ts';
import type { FolderEntry, FolderList } from '../../api/types.ts';
import { Input } from '../../components/forms/Input.tsx';
import { Sheet } from '../../components/layout/Drawer.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import { crumbsOf, folderErrorText, folderNameError, joinFolder, parentFolder } from './folder-path.ts';

/** The folder's place from the top: each step back is a button, the last one is where the browser is. */
function Crumbs({ listing, browser }: { listing: FolderList; browser: FolderBrowserState }) {
  const crumbs = crumbsOf(listing.path, listing.root);
  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-faint" />}
            {last ? (
              <span aria-current="location" className="truncate font-semibold text-ink">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void browser.go(crumb.path)}
                className="truncate rounded px-1 text-blue hover:underline"
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** One folder: opens on click, with its git and CLAUDE.md marks in words for screen readers. */
function FolderRow({ entry, onOpen }: { entry: FolderEntry; onOpen: () => void }) {
  const Icon = entry.git ? FolderGit2 : Folder;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
      >
        <Icon size={16} aria-hidden="true" className={entry.git ? 'text-blue' : 'text-dim'} />
        <span className="min-w-0 flex-1 truncate text-ink">{entry.name}</span>
        {entry.git && <span className="text-xs text-dim">git</span>}
        {entry.claudeMd && (
          <span className="flex items-center gap-1 text-xs text-dim">
            <FileText size={12} aria-hidden="true" />
            CLAUDE.md
          </span>
        )}
      </button>
    </li>
  );
}

/** The folders in the folder shown, or why there are none. */
function FolderRows({ listing, browser }: { listing: FolderList; browser: FolderBrowserState }) {
  if (listing.entries.length === 0) {
    return <p className="px-2.5 py-6 text-center text-sm text-dim">No folders here.</p>;
  }
  return (
    <>
      <ul aria-label={`Folders in ${listing.path}`} className="flex flex-col">
        {listing.entries.map((entry) => (
          <FolderRow
            key={entry.name}
            entry={entry}
            onOpen={() => void browser.go(joinFolder(listing.path, entry.name))}
          />
        ))}
      </ul>
      {listing.truncated && (
        <p className="px-2.5 pt-2 text-xs text-dim">Only the first 500 folders are shown.</p>
      )}
    </>
  );
}

/**
 * A name, then the new folder is made in the one shown and the browser goes into it. No form of its own: the sheet sits
 * inside the agent's form, so Enter makes the folder here instead of saving the agent.
 */
function NewFolder({ listing, browser }: { listing: FolderList; browser: FolderBrowserState }) {
  const id = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    const invalid = folderNameError(name);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(undefined);
    try {
      await browser.make(joinFolder(listing.path, name.trim()));
      setName('');
    } catch (failure) {
      setError(folderErrorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        New folder in {listing.path}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void submit();
          }}
          placeholder="scout"
          spellCheck={false}
          maxLength={255}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button icon={FolderPlus} busy={busy} onClick={() => void submit()}>
          New folder
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

export interface FolderBrowserProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly companyId: string;
  readonly machineId: string;
  readonly machineName: string;
  /** The home folder field's value: the browser starts there (or at its parent) when it exists. */
  readonly start: string;
  readonly onChoose: (path: string) => void;
}

/**
 * Browse… for the home folder: a machine's folders as its runner reads them, a step up, a new folder, and "Choose this
 * folder". A Docker runner shows only its work volume, /work.
 */
export function FolderBrowser(props: FolderBrowserProps) {
  const { open, onClose, companyId, machineId, machineName, start, onChoose } = props;
  const browser = useFolderBrowser(companyId, machineId);
  const { listing, error, loading } = browser;
  // biome-ignore lint/correctness/useExhaustiveDependencies: it starts again only when it opens or the machine changes.
  useEffect(() => {
    if (!open) return;
    const begin = start.trim();
    const parent = parentFolder(begin);
    void browser.openAt(begin.startsWith('/') ? [begin, ...(parent ? [parent] : [])] : []);
  }, [open, machineId]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Choose the home folder"
      description={`On ${machineName}. Its CLAUDE.md, skills and memory load from the folder you choose.`}
    >
      <div className="flex flex-col gap-4">
        {listing && (
          <div className="flex items-start gap-2">
            <Button
              size="sm"
              icon={ArrowUp}
              disabled={listing.parent === null || loading}
              onClick={() => listing.parent && void browser.go(listing.parent)}
            >
              Up
            </Button>
            <Crumbs listing={listing} browser={browser} />
          </div>
        )}
        {error !== undefined && <Notice tone="error">{folderErrorText(error)}</Notice>}
        {loading && !listing ? <SkeletonRows rows={4} /> : null}
        {listing && (
          <div aria-busy={loading} className={loading ? 'opacity-60' : undefined}>
            <FolderRows listing={listing} browser={browser} />
          </div>
        )}
        {listing && <NewFolder listing={listing} browser={browser} />}
        {listing && (
          <Button
            tone="primary"
            icon={Check}
            disabled={loading}
            onClick={() => {
              onChoose(listing.path);
              onClose();
            }}
          >
            Choose this folder
          </Button>
        )}
      </div>
    </Sheet>
  );
}

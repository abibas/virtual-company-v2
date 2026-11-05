import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogoStart } from '../forms/image/LogoPicker.tsx';
import { type PreparedLogo, releaseLogo } from '../forms/image/logo-file.ts';
import { companyAddress } from './slug.ts';

export interface CompanyDraft {
  readonly name: string;
  readonly slug: string;
  readonly logo: PreparedLogo | null;
  /** The address the company will get: the slug typed, else the one made from the name; empty until there is a name. */
  readonly address: string;
  /** An image the picker starts with (the gallery's sample), once loaded. */
  readonly startLogo: LogoStart | undefined;
  setName(name: string): void;
  setSlug(slug: string): void;
  setLogo(logo: PreparedLogo | null): void;
}

export interface DraftStart {
  readonly name?: string;
  readonly slug?: string;
  /** An image to start with (the gallery's sample), handed to the picker once. */
  readonly logo?: () => Promise<File>;
  /** Start in the crop step with it, instead of taking its centred square. */
  readonly crop?: boolean;
}

/** What is typed and picked on the create-company page, shared by the form and the live preview. */
export function useCompanyDraft(start: DraftStart = {}): CompanyDraft {
  const [name, setName] = useState(start.name ?? '');
  const [slug, setSlugState] = useState(start.slug ?? '');
  const [logo, setLogo] = useState<PreparedLogo | null>(null);
  const [startLogo, setStartLogo] = useState<LogoStart>();
  const latest = useRef(logo);
  latest.current = logo;
  useEffect(() => () => releaseLogo(latest.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting image is loaded once.
  useEffect(() => {
    const load = start.logo;
    if (!load) return;
    let current = true;
    load()
      .then((file) => current && setStartLogo({ file, crop: start.crop ?? false }))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  const setSlug = useCallback((value: string) => setSlugState(value.toLowerCase()), []);
  return { name, slug, logo, address: companyAddress(name, slug), startLogo, setName, setSlug, setLogo };
}

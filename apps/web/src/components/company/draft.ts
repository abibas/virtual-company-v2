import { useCallback, useEffect, useRef, useState } from 'react';
import { type PreparedLogo, prepareLogo, releaseLogo } from '../forms/logo-file.ts';
import { companyAddress } from './slug.ts';

export interface CompanyDraft {
  readonly name: string;
  readonly slug: string;
  readonly logo: PreparedLogo | null;
  /** The address the company will get: the slug typed, else the one made from the name; empty until there is a name. */
  readonly address: string;
  setName(name: string): void;
  setSlug(slug: string): void;
  setLogo(logo: PreparedLogo | null): void;
}

export interface DraftStart {
  readonly name?: string;
  readonly slug?: string;
  /** An image to start with (the gallery's sample), taken through `prepareLogo` once. */
  readonly logo?: () => Promise<File>;
}

/** What is typed and picked on the create-company page, shared by the form and the live preview. */
export function useCompanyDraft(start: DraftStart = {}): CompanyDraft {
  const [name, setName] = useState(start.name ?? '');
  const [slug, setSlugState] = useState(start.slug ?? '');
  const [logo, setLogo] = useState<PreparedLogo | null>(null);
  const latest = useRef(logo);
  latest.current = logo;
  useEffect(() => () => releaseLogo(latest.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting image is taken once.
  useEffect(() => {
    const load = start.logo;
    if (!load) return;
    let current = true;
    load()
      .then(prepareLogo)
      .then((prepared) => (current ? setLogo(prepared) : releaseLogo(prepared)))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  const setSlug = useCallback((value: string) => setSlugState(value.toLowerCase()), []);
  return { name, slug, logo, address: companyAddress(name, slug), setName, setSlug, setLogo };
}

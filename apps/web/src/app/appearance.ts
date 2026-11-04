import { useEffect, useMemo, useState } from 'react';

/** One design token of `styles/theme.css`, as the current colour scheme resolves it. */
function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(`--${name}`).trim();
}

/** Clerk's appearance variables from the app's tokens, so its sign-in card and user menu match the console. */
function readVariables() {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => token(style, `color-${name}`);
  return {
    colorPrimary: color('amber'),
    colorPrimaryForeground: color('ground'),
    colorBackground: color('panel-solid'),
    colorForeground: color('ink'),
    colorMuted: color('panel-2'),
    colorMutedForeground: color('dim'),
    colorInput: color('ground'),
    colorInputForeground: color('ink'),
    colorBorder: color('line-2'),
    colorNeutral: color('ink'),
    colorRing: color('amber'),
    colorDanger: color('alarm'),
    colorSuccess: color('pulse'),
    colorWarning: color('amber'),
    fontFamily: token(style, 'font-sans'),
    borderRadius: '4px',
  };
}

/** The appearance for `<ClerkProvider>`, read again when the system switches between light and dark. */
export function useClerkAppearance() {
  const [variables, setVariables] = useState(readVariables);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setVariables(readVariables());
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return useMemo(() => ({ variables }), [variables]);
}

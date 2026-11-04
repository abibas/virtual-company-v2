import { useMemo } from 'react';
import { useResolvedTheme } from './theme.ts';

/** One design token of `styles/tokens.css`, as the scheme on screen resolves it. */
function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(`--${name}`).trim();
}

/** Clerk's appearance variables from the app's tokens, so its sign-in card and user menu match the console. */
function readVariables() {
  const style = getComputedStyle(document.documentElement);
  return {
    colorPrimary: token(style, 'blue'),
    colorPrimaryForeground: token(style, 'on-blue'),
    colorBackground: token(style, 'surface'),
    colorForeground: token(style, 'ink'),
    colorMuted: token(style, 'surface-2'),
    colorMutedForeground: token(style, 'dim'),
    colorInput: token(style, 'surface-2'),
    colorInputForeground: token(style, 'ink'),
    colorBorder: token(style, 'line-2'),
    colorNeutral: token(style, 'ink'),
    colorRing: token(style, 'blue'),
    colorDanger: token(style, 'failed'),
    colorSuccess: token(style, 'done'),
    colorWarning: token(style, 'input'),
    fontFamily: token(style, 'font-sans'),
    borderRadius: '12px',
  };
}

/** The shapes Clerk's elements take in the house style: the card, pill buttons, rounded fields, a 32px avatar. */
const ELEMENTS = {
  cardBox: { boxShadow: 'var(--shadow-card)', borderRadius: '24px' },
  card: { boxShadow: 'none' },
  formButtonPrimary: { borderRadius: '9999px', fontWeight: 600, boxShadow: 'var(--shadow-primary)' },
  socialButtonsBlockButton: { borderRadius: '9999px' },
  formFieldInput: { borderRadius: '12px' },
  userButtonAvatarBox: { width: '32px', height: '32px' },
};

/** The appearance for `<ClerkProvider>`, read again when the scheme changes (the system's, or the toggle). */
export function useClerkAppearance() {
  const theme = useResolvedTheme();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is what changes the computed tokens.
  return useMemo(() => ({ variables: readVariables(), elements: ELEMENTS }), [theme]);
}

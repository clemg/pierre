import type { ThemeRegistration, ThemeRegistrationResolved } from 'shiki';

import { RegisteredCustomThemes, ResolvedThemes } from './constants';

export function registerCustomTheme(
  themeName: string,
  loader: () => Promise<ThemeRegistrationResolved | ThemeRegistration>
): void {
  if (RegisteredCustomThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name already registered',
      themeName
    );
    return;
  }
  RegisteredCustomThemes.set(themeName, loader);
}

// Replaces an existing theme registration and clears any cached resolution,
// so the next resolveTheme() call picks up the new loader. Useful for
// overriding a default theme with a locally-modified version.
export function forceRegisterCustomTheme(
  themeName: string,
  loader: () => Promise<ThemeRegistrationResolved | ThemeRegistration>
): void {
  RegisteredCustomThemes.set(themeName, loader);
  ResolvedThemes.delete(themeName);
}

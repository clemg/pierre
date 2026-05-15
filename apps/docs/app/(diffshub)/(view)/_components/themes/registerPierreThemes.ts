import { forceRegisterCustomTheme, registerCustomTheme } from '@pierre/diffs';
import type { ThemeRegistration } from 'shiki';

// The JSON theme files satisfy the ThemeRegistration shape at runtime, but
// TypeScript can't verify the deeply-inferred JSON type against it. We also
// override `name` to match the registered key, since resolveTheme validates
// that theme.name === themeName after loading.
//
// Dynamic JSON imports arrive as ES module objects `{ default: { ... } }`.
// resolveTheme does its own `result.default` unwrapping internally, so if we
// just spread the module we'd still expose a `default` key — meaning resolveTheme
// would unwrap it and see the original name from the JSON. We unwrap here first
// so our name override is what resolveTheme sees directly.
const load =
  (name: string, fn: () => Promise<unknown>) =>
  async (): Promise<ThemeRegistration> => {
    const mod = (await fn()) as Record<string, unknown>;
    const theme = ('default' in mod ? mod.default : mod) as ThemeRegistration;
    return { ...theme, name };
  };

// Registers all 6 local Pierre theme variants. The two base themes
// (pierre-light, pierre-dark) are force-registered to override the older
// versions bundled in @pierre/theme; the four variants are new and use the
// standard registration. Called once at module load time from WorkerPoolContext.
export function registerPierreThemes() {
  // Override the published npm defaults with the local, up-to-date copies.
  forceRegisterCustomTheme(
    'pierre-light',
    load('pierre-light', () => import('./pierre-light.json'))
  );
  forceRegisterCustomTheme(
    'pierre-dark',
    load('pierre-dark', () => import('./pierre-dark.json'))
  );
  registerCustomTheme(
    'pierre-light-soft',
    load('pierre-light-soft', () => import('./pierre-light-soft.json'))
  );
  registerCustomTheme(
    'pierre-light-vibrant',
    load('pierre-light-vibrant', () => import('./pierre-light-vibrant.json'))
  );
  registerCustomTheme(
    'pierre-dark-dim',
    load('pierre-dark-dim', () => import('./pierre-dark-dim.json'))
  );
  registerCustomTheme(
    'pierre-dark-vibrant',
    load('pierre-dark-vibrant', () => import('./pierre-dark-vibrant.json'))
  );
}

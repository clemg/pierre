import { defineConfig, type UserConfig } from 'tsdown';

// `docs-shared` ships pre-built JS to `dist/` so the consuming Next apps can
// drop it from `transpilePackages`. That keeps Turbopack and React Compiler
// from chewing through the ~30 `'use client'` shadcn/Radix wrappers on every
// dev compile (the practical perf reason this build step exists).
//
// `unbundle: true` mirrors the `src/` layout 1:1 into `dist/` and natively
// preserves `'use client'` directives (rolldown emits them at the top of each
// chunk). TypeScript types are still served from source via the package's
// `exports.types` condition (see package.json), so we skip dts emission here.
//
// CSS module files (currently just `Button.module.css`) are externalised so the
// emitted JS keeps a literal `import styles from './Button.module.css'`. The
// matching `.module.css` files are copied next to their JS siblings by
// `package.json`'s `build:assets` script so Next can process them as CSS
// modules at runtime.
const config: UserConfig = defineConfig({
  // `src/testing/*` is intentionally skipped: Bun and Playwright run those
  // helpers as raw TypeScript, so they never need a built `dist/` copy and
  // bundling them would force `@playwright/test` (a devDep with deep CJS
  // internals that confuse the neutral platform resolver) into the build
  // graph for no benefit.
  entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/testing/**'],
  tsconfig: './tsconfig.json',
  clean: true,
  unbundle: true,
  platform: 'neutral',
  // `node:*` builtins (used by `lib/mdx.tsx` for RSC file reads) are runtime
  // dependencies of the consuming Next app — list them explicitly so rolldown
  // marks the imports external instead of warning that it can't resolve them.
  external: [/^node:/],
  dts: false,
  plugins: [
    {
      name: 'externalize-css-modules',
      resolveId(source, importer) {
        if (importer && source.endsWith('.module.css')) {
          return { id: source, external: true };
        }
        return null;
      },
    },
  ],
});

export default config;

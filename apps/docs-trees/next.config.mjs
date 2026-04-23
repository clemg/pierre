import { loadWorktreeEnv } from '../../scripts/load-worktree-env.mjs';

// `next dev` runs under Node, which (like Bun) only auto-loads the standard
// `.env*` names. Our worktree helper writes `PIERRE_WORKTREE_SLUG` /
// `PIERRE_PORT_OFFSET` into `.env.worktree` at the worktree root, so pull those
// in manually before Next inspects `process.env`. When `ws.ts` is in the call
// chain it has already injected the same keys; the loader preserves those.
loadWorktreeEnv();

if (
  process.env.PIERRE_WORKTREE_SLUG &&
  !process.env.NEXT_PUBLIC_WORKTREE_SLUG
) {
  process.env.NEXT_PUBLIC_WORKTREE_SLUG = process.env.PIERRE_WORKTREE_SLUG;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  devIndicators: false,
  experimental: {
    cssChunking: 'strict',
  },
  // Resolve and transpile workspace packages so subpath exports (e.g.
  // @pierre/trees/react) resolve correctly when Next follows client-component
  // imports from the server. `@pierre/docs-shared` is intentionally NOT in this
  // list: it ships pre-built JS to `dist/` so React Compiler / Turbopack treat
  // it like a normal node_modules dep and skip recompiling its 30-odd
  // `'use client'` shadcn/Radix wrappers on every dev build.
  transpilePackages: ['@pierre/diffs', '@pierre/trees'],
  // Opt the /trees-dev route out of bfcache / HTTP document caching.
  // iOS Safari kills tabs that briefly hold two copies of the 1.6M-path AOSP
  // tree during a refresh; no-store tells the browser to fully release the old
  // document before it starts booting the new one.
  headers() {
    return [
      {
        source: '/trees-dev',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ];
  },
  redirects() {
    // Legacy `/trees/*` URLs from the unified-app days collapse to the bare
    // path now that trees lives at the root of trees.software.
    return [
      { source: '/trees', destination: '/', permanent: true },
      { source: '/trees/docs', destination: '/docs', permanent: true },
      { source: '/new', destination: '/', permanent: true },
      { source: '/trees/new', destination: '/', permanent: true },
    ];
  },
};

export default nextConfig;

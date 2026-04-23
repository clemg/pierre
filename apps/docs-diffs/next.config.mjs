import { loadWorktreeEnv } from '../../scripts/load-worktree-env.mjs';

// `next dev` runs under Node, which (like Bun) only auto-loads the standard
// `.env*` names. Our worktree helper writes `PIERRE_WORKTREE_SLUG` /
// `PIERRE_PORT_OFFSET` into `.env.worktree` at the worktree root, so pull those
// in manually before Next inspects `process.env`. When `ws.ts` is in the call
// chain it has already injected the same keys; the loader preserves those.
loadWorktreeEnv();

// The browser title prefix (see `app/layout.tsx`) reads
// `NEXT_PUBLIC_WORKTREE_SLUG` so the value survives into the client bundle.
// Bridge it from the non-prefixed worktree slug so `.env.worktree` stays the
// single source of truth.
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
  // @pierre/diffs/react) resolve correctly when Next follows client-component
  // imports from the server. `@pierre/docs-shared` is intentionally NOT in this
  // list: it ships pre-built JS to `dist/` so React Compiler / Turbopack treat
  // it like a normal node_modules dep and skip recompiling its 30-odd
  // `'use client'` shadcn/Radix wrappers on every dev build.
  transpilePackages: ['@pierre/diffs', '@pierre/trees', '@pierre/truncate'],
  redirects() {
    // Anything pointing at /trees on the diffs domain belongs on trees.software.
    return [
      {
        source: '/trees/:path*',
        destination: 'https://trees.software/:path*',
        permanent: false,
      },
      {
        source: '/trees',
        destination: 'https://trees.software',
        permanent: false,
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      '@pierre/truncate/style.css': '../../packages/truncate/src/style.css',
    },
  },
};

export default nextConfig;

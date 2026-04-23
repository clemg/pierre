// When running in a worktree, prefix the docs site title with a stable emoji +
// slug so browser tabs for different worktrees are distinguishable at a glance.
// The slug reaches this module via `next.config.mjs`, which loads
// `.env.worktree` and bridges `PIERRE_WORKTREE_SLUG` into
// `NEXT_PUBLIC_WORKTREE_SLUG`. No-op in the main clone.

export const WORKTREE_EMOJI_PALETTE = [
  '🟢',
  '🔵',
  '🟡',
  '🟠',
  '🟣',
  '🔴',
  '🟤',
  '⚪',
] as const;

export function worktreeTitlePrefix(): string {
  const slug = process.env.NEXT_PUBLIC_WORKTREE_SLUG;
  if (!slug) return '';
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  const emoji = WORKTREE_EMOJI_PALETTE[hash % WORKTREE_EMOJI_PALETTE.length];
  return `${emoji} [${slug}] `;
}

// Computed once at module evaluation; the slug never changes within a process.
export const WORKTREE_PREFIX = worktreeTitlePrefix();

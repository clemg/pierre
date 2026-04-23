export type ProductId = 'diffs' | 'trees';

export interface ProductConfig {
  id: ProductId;
  name: string;
  tagline: string;
  description: string;
  llmsDescription: string;
  packageName: string;
  installCommand: string;
  githubUrl: string;
  /**
   * External base URL where this product is hosted. Used for cross-site links
   * in headers, footers, and MDX whenever the current site needs to point at
   * the *other* product.
   */
  externalUrl: string;
}

/**
 * Static product registry. No env reads, no path mutation: every consumer asks
 * for cross-site URLs by passing the explicit `currentSite` they're rendering
 * for via `useSite()` or a prop.
 */
export const PRODUCTS: Record<ProductId, ProductConfig> = {
  diffs: {
    id: 'diffs',
    name: 'Diffs',
    tagline: 'A diff rendering library',
    description:
      "@pierre/diffs is an open source diff and code rendering library. It's built on Shiki for syntax highlighting and theming, is super customizable, and comes packed with features.",
    llmsDescription:
      'An open source diff and code rendering library for the web. Built on Shiki for syntax highlighting, with React and vanilla JS APIs, virtualization, SSR support, and extensive theming.',
    packageName: '@pierre/diffs',
    installCommand: 'bun i @pierre/diffs',
    githubUrl: 'https://github.com/pierrecomputer/pierre',
    externalUrl: 'https://diffs.com',
  },
  trees: {
    id: 'trees',
    name: 'Trees',
    tagline: 'A file tree rendering library',
    description:
      "@pierre/trees is an open source file tree rendering library. It's built for performance and flexibility, is super customizable, and comes packed with features.",
    llmsDescription:
      'An open source file tree rendering library for the web. Built for extreme performance on large trees, with React and vanilla JS APIs, SSR support, and customizable styling.',
    packageName: '@pierre/trees',
    installCommand: 'bun i @pierre/trees',
    githubUrl: 'https://github.com/pierrecomputer/pierre',
    externalUrl: 'https://trees.software',
  },
};

/**
 * The diffs site is the only one that hosts the theme gallery, so cross-site
 * links to it always resolve relative to the diffs origin.
 */
export const DIFFS_THEME_PATH = '/theme';

export function getProductConfig(productId: ProductId): ProductConfig {
  return PRODUCTS[productId];
}

/**
 * Build a URL that points at `target` from a page being rendered for `current`.
 * - If they're the same product, return a relative path.
 * - If they're different, return an absolute URL on the target product's domain.
 *
 * Use this for any nav/footer/MDX link that may resolve cross-site.
 */
export function productUrl(
  current: ProductId,
  target: ProductId,
  path = '/'
): string {
  if (current === target) {
    return path;
  }
  return `${PRODUCTS[target].externalUrl}${path === '/' ? '' : path}`;
}

/**
 * Convenience for pages that always live on the diffs site (e.g. /theme).
 * On diffs renders the bare path; on trees renders the absolute diffs URL.
 */
export function diffsThemeUrl(current: ProductId): string {
  return productUrl(current, 'diffs', DIFFS_THEME_PATH);
}

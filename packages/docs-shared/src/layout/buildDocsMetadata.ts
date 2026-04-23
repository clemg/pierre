import type { Metadata } from 'next';

import { type ProductId, PRODUCTS } from '../config/products';
import { WORKTREE_PREFIX } from './worktreeTitlePrefix';

export interface BuildDocsMetadataOptions {
  site: ProductId;
  /**
   * When true, emits the favicon `icons` block. The diffs app uses this; the
   * trees app omits it because its segment-level file-convention assets
   * (`icon.svg`, `apple-icon.png`) take over.
   */
  includeFaviconIcons?: boolean;
}

export function buildDocsMetadata({
  site,
  includeFaviconIcons = false,
}: BuildDocsMetadataOptions): Metadata {
  const product = PRODUCTS[site];
  const baseTitle = `${product.name}, from Pierre`;
  const taggedTitle = `${WORKTREE_PREFIX}${baseTitle}`;
  const titleTemplate = `${WORKTREE_PREFIX}%s`;
  const description = product.description;

  return {
    metadataBase: new URL(product.externalUrl),
    title: {
      default: taggedTitle,
      template: titleTemplate,
    },
    description,
    ...(includeFaviconIcons
      ? {
          icons: {
            icon: [
              { url: '/favicon.svg', type: 'image/svg+xml' },
              { url: '/favicon.png', type: 'image/png' },
            ],
            apple: '/apple-touch-icon.png',
          },
        }
      : {}),
    openGraph: {
      title: {
        default: taggedTitle,
        template: titleTemplate,
      },
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: {
        default: taggedTitle,
        template: titleTemplate,
      },
      description,
    },
  };
}

'use client';

import { createContext, type ReactNode, useContext } from 'react';

import { type ProductId } from '../config/products';

const SiteContext = createContext<ProductId | undefined>(undefined);

export interface SiteProviderProps {
  site: ProductId;
  children: ReactNode;
}

/**
 * Each app installs this once near the root with a constant `site` prop. Every
 * shared component that needs to know which site it's rendering on calls
 * `useSite()` instead of reading `process.env.NEXT_PUBLIC_SITE`, so the shared
 * package has zero env-var coupling.
 */
export function SiteProvider({ site, children }: SiteProviderProps) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite(): ProductId {
  const site = useContext(SiteContext);
  if (site == null) {
    throw new Error(
      'useSite() called outside of <SiteProvider>. Wrap your app root with <SiteProvider site="diffs|trees"> in app/layout.tsx.'
    );
  }
  return site;
}

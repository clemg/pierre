import type { ReactNode } from 'react';

import { ThemeProvider } from '../components/theme-provider';
import { Toaster } from '../components/ui/sonner';
import { type ProductId } from '../config/products';
import { SiteProvider } from '../site/SiteContext';
import { themeBootstrapScript } from './themeBootstrap';

export interface RootLayoutShellProps {
  /** Which product this app renders ('diffs' or 'trees'). */
  site: ProductId;
  /**
   * Space-separated `next/font` variable classNames applied to the `<html>`
   * element. `next/font` only generates CSS variables when invoked from the
   * consuming Next.js app's own files, so each app loads its fonts in
   * `app/layout.tsx` and forwards the joined class string here.
   */
  fontClassName: string;
  children: ReactNode;
}

/**
 * Shared <html>/<body> shell. Each app's `app/layout.tsx` calls this once and
 * just supplies its own metadata, `site` prop, and `fontClassName`. Keeps the
 * theme bootstrap script, ThemeProvider, Sonner toaster, and dark/light portal
 * containers in one place so both docs apps stay in lockstep.
 */
export function RootLayoutShell({
  site,
  fontClassName,
  children,
}: RootLayoutShellProps) {
  return (
    <html lang="en" suppressHydrationWarning className={fontClassName}>
      <head>
        <script
          id="docs-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body>
        <SiteProvider site={site}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
            <Toaster />
            <div
              id="dark-mode-portal-container"
              className="dark"
              data-theme="dark"
            ></div>
            <div
              id="light-mode-portal-container"
              className="light"
              data-theme="light"
            ></div>
          </ThemeProvider>
        </SiteProvider>
      </body>
    </html>
  );
}

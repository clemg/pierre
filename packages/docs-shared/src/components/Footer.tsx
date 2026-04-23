'use client';

import Link from 'next/link';

import { diffsThemeUrl, PRODUCTS, productUrl } from '../config/products';
import { useSite } from '../site/SiteContext';

const linkClass =
  'text-muted-foreground hover:text-foreground text-sm transition-colors';

export default function Footer() {
  const site = useSite();
  const diffsHome = productUrl(site, 'diffs', '/');
  const diffsDocs = productUrl(site, 'diffs', '/docs');
  const diffsPlayground = productUrl(site, 'diffs', '/playground');
  const diffsTheme = diffsThemeUrl(site);
  const treesHome = productUrl(site, 'trees', '/');
  const treesDocs = productUrl(site, 'trees', '/docs');

  return (
    <footer className="pt-12 pb-12">
      <div className="grid-cols- grid gap-3 md:grid-cols-5 md:justify-between">
        <div className="text-muted-foreground text-sm">
          &copy; {new Date().getFullYear()} The Pierre Computer Co.
        </div>
        <div className="hidden md:block" />
        <div>
          <h4 className="mb-2 text-sm font-medium">{PRODUCTS.diffs.name}</h4>
          <nav className="flex flex-col gap-1">
            <Link href={diffsHome} className={linkClass}>
              Home
            </Link>
            <Link href={diffsDocs} className={linkClass}>
              Docs
            </Link>
            <Link href={diffsPlayground} className={linkClass}>
              Playground
            </Link>
            <Link href={diffsTheme} className={linkClass}>
              Theme
            </Link>
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">{PRODUCTS.trees.name}</h4>
          <nav className="flex flex-col gap-1">
            <Link href={treesHome} className={linkClass}>
              Home
            </Link>
            <Link href={treesDocs} className={linkClass}>
              Docs
            </Link>
          </nav>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-medium">Community</h4>
          <nav className="flex flex-col gap-1">
            <Link
              href="https://x.com/pierrecomputer"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              X
            </Link>
            <Link
              href="https://discord.gg/pierre"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Discord
            </Link>
            <Link
              href="https://github.com/pierrecomputer/pierre"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              GitHub
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

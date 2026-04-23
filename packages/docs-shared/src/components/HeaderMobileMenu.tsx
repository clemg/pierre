'use client';

import { useEffect } from 'react';

import { diffsThemeUrl, PRODUCTS, productUrl } from '../config/products';
import { useSite } from '../site/SiteContext';
import { MobileNavLink } from './MobileNavLink';

export interface HeaderMobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Self-contained mobile popover used by the Header on pages that don't
 * already render a docs-style sidebar (home, playground, ssr). On docs/theme
 * pages the DocsSidebar popover is used instead and includes a TOC section.
 */
export function HeaderMobileMenu({ isOpen, onClose }: HeaderMobileMenuProps) {
  const site = useSite();
  const otherSite = site === 'diffs' ? 'trees' : 'diffs';
  const themeHref = diffsThemeUrl(site);
  const themeIsExternal = site !== 'diffs';

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isOpen]);

  return (
    <>
      {isOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <nav
        className={`mobile-popover md:hidden ${isOpen ? 'is-open' : ''}`}
        onClick={onClose}
      >
        <MobileNavLink href="/">Home</MobileNavLink>
        <MobileNavLink href="/docs">Docs</MobileNavLink>
        <MobileNavLink href={productUrl(site, otherSite, '/')} external>
          {PRODUCTS[otherSite].name}
        </MobileNavLink>
        <MobileNavLink href={themeHref} external={themeIsExternal}>
          Theme
        </MobileNavLink>
      </nav>
    </>
  );
}

export default HeaderMobileMenu;

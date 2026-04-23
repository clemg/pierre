'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { MobileNavLink } from '../components/MobileNavLink';
import NavLink from '../components/NavLink';
import { diffsThemeUrl, productUrl } from '../config/products';
import { useSite } from '../site/SiteContext';

interface DocsSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface HeadingItem {
  id: string;
  text: string;
  level: number;
  element: HTMLElement;
}

export function DocsSidebar({
  isMobileOpen = false,
  onMobileClose,
}: DocsSidebarProps) {
  const site = useSite();
  const navRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string>('');

  // Extract headings from the page content
  // IDs are set server-side by rehype-hierarchical-slug during MDX compilation
  useLayoutEffect(() => {
    const headingElements = document.querySelectorAll('h2[id], h3[id]');
    const headingItems: HeadingItem[] = [];

    for (const element of headingElements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const text = element.textContent ?? '';
      const level = parseInt(element.tagName.charAt(1));
      const id = element.id;

      headingItems.push({
        id,
        text,
        level,
        element,
      });
    }

    setHeadings(headingItems);

    if (headingItems.length > 0 && window.location.hash.trim() === '') {
      setActiveHeading(headingItems[0].id);
    }

    if (window.location.hash.trim() !== '') {
      const id = window.location.hash.slice(1);
      const element = document.getElementById(id);
      if (element != null) {
        element.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      let foundActive = false;

      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        const rect = heading.element.getBoundingClientRect();
        if (rect.top <= 100) {
          setActiveHeading(heading.id);
          foundActive = true;
          break;
        }
      }

      if (!foundActive && headings.length > 0) {
        setActiveHeading(headings[0].id);
      }
    };

    if (headings.length > 0) {
      window.addEventListener('scroll', handleScroll);
      handleScroll();

      return () => window.removeEventListener('scroll', handleScroll);
    }

    return undefined;
  }, [headings]);

  useEffect(() => {
    const nav = navRef.current;
    if (activeHeading === '' || nav == null) {
      return;
    }

    const activeLink = nav.querySelector(
      `a[href="#${CSS.escape(activeHeading)}"]`
    );

    if (activeLink instanceof HTMLElement) {
      const linkTop = activeLink.offsetTop;
      const linkHeight = activeLink.offsetHeight;
      const navHeight = nav.clientHeight;
      const scrollTarget = linkTop - navHeight / 2 + linkHeight / 2;

      nav.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }
  }, [activeHeading]);

  const otherSite = site === 'diffs' ? 'trees' : 'diffs';

  return (
    <>
      {isMobileOpen && (
        <div
          className="bg-background/50 fixed inset-0 z-[50] backdrop-blur-sm transition-opacity duration-200 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <nav
        ref={navRef}
        className={`mobile-popover docs-sidebar ${isMobileOpen ? 'is-open' : ''}`}
        onClick={onMobileClose}
      >
        {isMobileOpen && (
          <div className="border-border mb-4 border-b pb-4 md:hidden">
            <MobileNavLink href="/">Home</MobileNavLink>
            <MobileNavLink href="/docs">Docs</MobileNavLink>
            <MobileNavLink
              href={productUrl(site, otherSite, '/')}
              external={otherSite !== site}
            >
              {otherSite === 'diffs' ? 'Diffs' : 'Trees'}
            </MobileNavLink>
            <MobileNavLink
              href={diffsThemeUrl(site)}
              external={site !== 'diffs'}
            >
              Theme
            </MobileNavLink>
          </div>
        )}
        {headings.map((heading) => (
          <NavLink
            key={heading.id}
            href={`#${heading.id}`}
            active={activeHeading === heading.id}
            className={`mr-[2px] ${heading.level === 3 ? 'ml-4' : ''}`}
          >
            {heading.text}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default DocsSidebar;

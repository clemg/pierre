'use client';

import {
  IconArrowUpRight,
  IconBrandDiscord,
  IconBrandGithub,
  IconChevronFlat,
  IconParagraph,
} from '@pierre/icons';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PRODUCTS, productUrl } from '../config/products';
import { cn } from '../lib/utils';
import { useSite } from '../site/SiteContext';
import { HeaderMobileMenu } from './HeaderMobileMenu';
import { Button } from './ui/button';

export interface HeaderProps {
  onMobileMenuToggle?: () => void;
  className?: string;
}

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  /** When provided, override the default isActive heuristic. */
  active?: boolean;
}

function NavLink({ href, children, active }: NavLinkProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className={cn(
        'text-muted-foreground font-normal px-2 gap-0.5',
        active === true && 'text-foreground pointer-events-none font-medium'
      )}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}

interface IconLinkProps {
  href: string;
  label: string;
  children: React.ReactNode;
}

function IconLink({ href, label, children }: IconLinkProps) {
  return (
    <Button variant="ghost" size="icon" asChild>
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
      >
        {children}
      </Link>
    </Button>
  );
}

function isPathActive(currentPath: string, target: string): boolean {
  if (target === '/') {
    return currentPath === '/';
  }
  return currentPath === target || currentPath.startsWith(`${target}/`);
}

export function Header({ onMobileMenuToggle, className }: HeaderProps) {
  const site = useSite();
  const product = PRODUCTS[site];
  const [isStuck, setIsStuck] = useState(false);
  const [internalMenuOpen, setInternalMenuOpen] = useState(false);
  const [pathname, setPathname] = useState('/');

  useEffect(() => {
    setPathname(window.location.pathname);
  }, []);

  useEffect(() => {
    let lastStuck: boolean | undefined;
    const handleScroll = () => {
      const isStuck = window.scrollY > 0;
      if (isStuck !== lastStuck) {
        lastStuck = isStuck;
        setIsStuck(isStuck);
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // When no parent-managed handler is provided, the Header owns its own
  // mobile popover (used on home, playground, ssr). Docs/theme pages pass a
  // handler so the existing DocsSidebar popover can be opened instead.
  const ownsPopover = onMobileMenuToggle == null;
  const handleMobileToggle = ownsPopover
    ? () => setInternalMenuOpen((v) => !v)
    : onMobileMenuToggle;

  const otherSite = site === 'diffs' ? 'trees' : 'diffs';

  return (
    <header
      data-slot="header"
      className={cn(
        'bg-background bg-clip-padding sticky top-0 z-40 flex items-center justify-between gap-4 py-3 transition-[border-color,box-shadow] duration-200 px-5 -mx-5 md:mx-0 md:px-0',
        isStuck ? 'is-stuck' : 'border-b border-transparent',
        className
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <Link
          href="/"
          className="text-foreground hover:text-foreground/80 text-lg leading-[20px] font-semibold transition-colors"
        >
          {product.name}
        </Link>
        <span className="text-muted-foreground hidden text-sm leading-[20px] md:inline">
          by{' '}
          <Link
            href="https://pierre.computer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground/80 hidden text-sm leading-[20px] transition-colors md:inline"
          >
            The Pierre Computer Co.
          </Link>
        </span>
      </div>

      <div className="mr-auto flex items-center gap-1 md:hidden">
        <IconChevronFlat size={16} className="text-border" />
        <Button variant="ghost" size="icon" onClick={handleMobileToggle}>
          <IconParagraph />
        </Button>
      </div>

      {ownsPopover && (
        <HeaderMobileMenu
          isOpen={internalMenuOpen}
          onClose={() => setInternalMenuOpen(false)}
        />
      )}

      <nav className="flex items-center">
        <div className="hidden items-center md:flex">
          <NavLink href="/" active={isPathActive(pathname, '/')}>
            Home
          </NavLink>
          <NavLink href="/docs" active={isPathActive(pathname, '/docs')}>
            Docs
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground gap-0.5 px-2 font-normal"
          >
            <Link
              href={productUrl(site, otherSite, '/')}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PRODUCTS[otherSite].name}
              <IconArrowUpRight />
            </Link>
          </Button>

          <div className="border-border mx-2 h-5 w-px border-l" />
        </div>

        <IconLink href="https://discord.gg/pierre" label="Discord">
          <IconBrandDiscord />
        </IconLink>

        <IconLink href={product.githubUrl} label="GitHub">
          <IconBrandGithub />
        </IconLink>
      </nav>
    </header>
  );
}

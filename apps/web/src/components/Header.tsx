import { ChevronDown, Github, Menu, MessageSquare, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FEEDBACK_HREF, GITHUB_REPO_URL } from '@/lib/support';
import { cn } from '@/lib/utils';
import { getNavigation } from '../../../../config/navigation';

const mode = import.meta.env.MODE === 'production' ? 'production' : 'development';
const navItems = getNavigation(mode);

/**
 * The icon links the bar ends with, in Explore's order and with its icons: Explore's app bar and
 * the docs' nav end the same way, so they sit on the same line when the reader switches pages.
 */
const END_LINKS = [
  { label: 'Feedback', href: FEEDBACK_HREF, Icon: MessageSquare, newTab: false },
  { label: 'GitHub', href: GITHUB_REPO_URL, Icon: Github, newTab: true },
] as const;

/** A 16 px icon at the kit's stroke, as in Explore's app bar; decorative. */
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

const newTabProps = { target: '_blank', rel: 'noopener noreferrer' } as const;

const textClass = 'text-foreground';
const hoverTextClass = 'hover:text-primary';
const mutedTextClass = 'text-foreground/80';
const dropdownClasses =
  'absolute top-full right-0 mt-2 w-48 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 border bg-background border-border/40';
/** Sized and spaced like Explore's icon buttons (config/site-bar.css): the background changes on
    hover, the colour stays. */
const iconButtonClass =
  'inline-flex size-(--site-bar-icon-box) flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type HeaderProps = {
  className?: string;
};

/**
 * The site header of the landing and privacy pages; the explore page has its own app bar. Both,
 * and the docs' nav, take their height, wordmark and insets from config/site-bar.css.
 */
const Header = ({ className }: HeaderProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const headerClasses = cn(
    'fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-lg bg-background/85 border-border',
    className,
  );

  return (
    <header className={headerClasses}>
      {/* The bar is --site-bar-height tall with the header's border, as Explore's app bar is. */}
      <div className="flex h-[calc(var(--site-bar-height)-1px)] items-center justify-between ps-(--site-bar-inset-start) pe-(--site-bar-inset-end)">
        <Link to="/" className="flex items-center">
          <img src="/wordmark.svg" alt="ProtSpace" className="block h-(--site-bar-logo-height)" />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">
          <nav className="flex items-center gap-8">
            {navItems.map((item) => {
              // Dropdown menu
              if (item.items) {
                return (
                  <div key={item.text} className="relative group">
                    <button
                      className={cn(
                        'flex items-center gap-1 text-sm font-medium transition-colors',
                        textClass,
                        hoverTextClass,
                      )}
                    >
                      {item.text}
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <div className={dropdownClasses}>
                      {item.items.map((subItem) => (
                        <a
                          key={subItem.text}
                          href={subItem.link}
                          {...newTabProps}
                          className={cn(
                            'block px-4 py-2 text-sm first:rounded-t-lg last:rounded-b-lg transition-colors',
                            textClass,
                            hoverTextClass,
                            'hover:bg-muted/50',
                          )}
                        >
                          {subItem.text}
                        </a>
                      ))}
                    </div>
                  </div>
                );
              }

              const linkClasses = cn(
                'text-sm font-medium transition-colors',
                textClass,
                hoverTextClass,
              );

              // Internal link
              if (item.internal && item.link) {
                return (
                  <Link key={item.text} to={item.link} className={linkClasses}>
                    {item.text}
                  </Link>
                );
              }

              // External link
              return (
                <a key={item.text} href={item.link} className={linkClasses}>
                  {item.text}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-(--site-bar-icon-gap)">
            {END_LINKS.map(({ label, href, Icon, newTab }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <a
                    href={href}
                    className={iconButtonClass}
                    aria-label={label}
                    {...(newTab ? newTabProps : {})}
                  >
                    <Icon {...ICON} />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Mobile Menu Button: the bar's last button, where Explore's search button sits. Its
            lines sit 2 px left of centre, so they end where that search icon ends (as the docs'
            menu button does). */}
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={cn(iconButtonClass, textClass, 'md:hidden')}
          aria-label="Toggle menu"
          aria-expanded={isMenuOpen}
        >
          {isMenuOpen ? (
            <X className="mr-1" aria-hidden="true" />
          ) : (
            <Menu className="mr-1" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Mobile Navigation */}
      {isMenuOpen && (
        <nav className="md:hidden px-(--site-bar-inset-start) py-4 space-y-3 border-t border-border/40">
          {navItems.map((item) => {
            // Dropdown menu
            if (item.items) {
              return (
                <div key={item.text}>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === item.text ? null : item.text)}
                    className={cn(
                      'flex items-center justify-between w-full py-2 text-sm font-medium transition-colors',
                      textClass,
                      hoverTextClass,
                    )}
                  >
                    {item.text}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        openDropdown === item.text ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {openDropdown === item.text && (
                    <div className="pl-4 space-y-2 mt-2">
                      {item.items.map((subItem) => (
                        <a
                          key={subItem.text}
                          href={subItem.link}
                          {...newTabProps}
                          className={cn(
                            'block py-2 text-sm transition-colors',
                            mutedTextClass,
                            hoverTextClass,
                          )}
                        >
                          {subItem.text}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const linkClasses = cn(
              'block py-2 text-sm font-medium transition-colors',
              textClass,
              hoverTextClass,
            );

            // Internal link (SPA navigation - needs onClick to close menu)
            if (item.internal && item.link) {
              return (
                <Link
                  key={item.text}
                  to={item.link}
                  className={linkClasses}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item.text}
                </Link>
              );
            }

            // External link (full page load - onClick is redundant but harmless)
            return (
              <a
                key={item.text}
                href={item.link}
                className={linkClasses}
                onClick={() => setIsMenuOpen(false)}
              >
                {item.text}
              </a>
            );
          })}

          {/* The bar's icon links, named, in the same order. */}
          {END_LINKS.map(({ label, href, Icon, newTab }) => (
            <a
              key={label}
              href={href}
              className={cn(
                'flex items-center gap-2 py-2 text-sm font-medium transition-colors',
                textClass,
                hoverTextClass,
              )}
              {...(newTab ? newTabProps : {})}
              onClick={() => setIsMenuOpen(false)}
            >
              <Icon {...ICON} />
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
};

export default Header;

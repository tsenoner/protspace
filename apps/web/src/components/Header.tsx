import { ChevronDown, Github, Menu, MessageSquare, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ICON } from '@/lib/icon';
import { notifyCopied } from '@/lib/notify';
import { FEEDBACK_MENU_ITEMS, GITHUB_REPO_URL, runFeedbackAction } from '@/lib/support';
import { cn } from '@/lib/utils';
import { getNavigation } from '../../../../config/navigation';
import { SiteFeedbackMenu } from './SiteFeedbackMenu';
import { SiteThemeChoice, SiteThemeToggle } from './SiteThemeToggle';

const mode = import.meta.env.MODE === 'production' ? 'production' : 'development';
const navItems = getNavigation(mode);

const newTabProps = { target: '_blank', rel: 'noopener noreferrer' } as const;

const textClass = 'text-foreground';
/** ProtSpace's accent text colour (--ps-accent-text), which the docs' nav uses as its brand colour
    too: the hover and the current page are the same blue in both bars. */
const hoverTextClass = 'hover:text-link';
const activeTextClass = 'text-link';
/** Classes for an internal link: the current page is marked, as the docs' nav marks Docs. */
const navLinkClass =
  (base: string) =>
  ({ isActive }: { isActive: boolean }) =>
    cn(base, isActive ? activeTextClass : textClass, hoverTextClass);
const mutedTextClass = 'text-foreground/80';
const dropdownClasses =
  'absolute top-full right-0 mt-2 w-48 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all duration-200 border bg-background border-border/40';
/** Sized, spaced and coloured like Explore's icon buttons (config/site-bar.css, the --ps-* tokens):
    the background changes on hover, the colour stays. */
const iconButtonClass =
  'inline-flex size-(--site-bar-icon-box) flex-none items-center justify-center rounded-[var(--ps-radius)] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type HeaderProps = {
  className?: string;
  /**
   * The id of a large wordmark on the page (the landing's hero). While it is wholly in view the
   * bar's wordmark stays hidden; as soon as it starts to scroll under the bar, the bar's fades in,
   * where the docs' and Explore's bars have theirs.
   */
  heroLogoId?: string;
};

/** Whether the element `id` has started to go under the bar (true without one). */
function useScrolledPast(id: string | undefined): boolean {
  const [past, setPast] = useState(!id);
  useEffect(() => {
    const target = id ? document.getElementById(id) : null;
    if (!target) {
      setPast(true);
      return;
    }
    const barHeight = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--site-bar-height') || '48',
    );
    // The moment its top edge reaches the bar's bottom, not once it has gone under entirely: a
    // large wordmark takes a long scroll to disappear, and in between neither would be readable.
    const observer = new IntersectionObserver(
      ([entry]) => setPast(entry.intersectionRatio < 1 && entry.boundingClientRect.top < barHeight),
      { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [id]);
  return past;
}

/**
 * The site header of the landing and privacy pages; the explore page has its own app bar. Both,
 * and the docs' nav, take their height, wordmark and insets from config/site-bar.css.
 */
const Header = ({ className, heroLogoId }: HeaderProps) => {
  const logoShown = useScrolledPast(heroLogoId);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const headerClasses = cn(
    'fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-lg bg-background/85 border-border font-ps',
    className,
  );

  return (
    <header className={headerClasses}>
      {/* The bar is --site-bar-height tall with the header's border, as Explore's app bar is. */}
      <div className="flex h-[calc(var(--site-bar-height)-1px)] items-center justify-between ps-(--site-bar-inset-start) pe-(--site-bar-inset-end)">
        {/* Hidden (and out of the Tab order) while the hero's large wordmark is in view. */}
        <Link
          to="/"
          className={cn(
            'flex items-center transition-opacity duration-300 ease-out motion-reduce:transition-none',
            logoShown ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          aria-hidden={!logoShown || undefined}
          tabIndex={logoShown ? undefined : -1}
        >
          {/* Its dark ink turned light in dark, as Explore's (--ps-logo-filter). */}
          <img
            src="/wordmark.svg"
            alt="ProtSpace"
            className="block h-(--site-bar-logo-height) [filter:var(--ps-logo-filter)]"
          />
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
                  <NavLink
                    key={item.text}
                    to={item.link}
                    end
                    className={navLinkClass('text-sm font-medium transition-colors')}
                  >
                    {item.text}
                  </NavLink>
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

          {/* Theme, Feedback, GitHub: the order and the icons of the docs' and Explore's bars. */}
          <div className="flex items-center gap-(--site-bar-icon-gap)">
            <SiteThemeToggle className={iconButtonClass} />
            <SiteFeedbackMenu className={iconButtonClass} />
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={GITHUB_REPO_URL}
                  className={iconButtonClass}
                  aria-label="GitHub"
                  {...newTabProps}
                >
                  <Github {...ICON} />
                </a>
              </TooltipTrigger>
              <TooltipContent side="bottom">GitHub</TooltipContent>
            </Tooltip>
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
                <NavLink
                  key={item.text}
                  to={item.link}
                  end
                  className={navLinkClass('block py-2 text-sm font-medium transition-colors')}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item.text}
                </NavLink>
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

          {/* The bar's icon buttons, named, in the same order: Theme as a Light | Dark pair,
              Feedback's entries in place, then GitHub. */}
          <SiteThemeChoice className="py-1 text-sm font-medium" />
          <div>
            <button
              type="button"
              onClick={() => setOpenDropdown(openDropdown === 'Feedback' ? null : 'Feedback')}
              aria-expanded={openDropdown === 'Feedback'}
              className={cn(
                'flex items-center justify-between w-full py-2 text-sm font-medium transition-colors',
                textClass,
                hoverTextClass,
              )}
            >
              <span className="flex items-center gap-2">
                <MessageSquare {...ICON} />
                Feedback
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  openDropdown === 'Feedback' && 'rotate-180',
                )}
              />
            </button>
            {openDropdown === 'Feedback' && (
              <div className="pl-6 space-y-2 mt-2">
                {FEEDBACK_MENU_ITEMS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      'block py-2 text-left text-sm transition-colors',
                      mutedTextClass,
                      hoverTextClass,
                    )}
                    onClick={() => {
                      setIsMenuOpen(false);
                      runFeedbackAction(value, notifyCopied);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <a
            href={GITHUB_REPO_URL}
            className={cn(
              'flex items-center gap-2 py-2 text-sm font-medium transition-colors',
              textClass,
              hoverTextClass,
            )}
            {...newTabProps}
            onClick={() => setIsMenuOpen(false)}
          >
            <Github {...ICON} />
            GitHub
          </a>
        </nav>
      )}
    </header>
  );
};

export default Header;

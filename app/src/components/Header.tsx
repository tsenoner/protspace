import { Menu, X, ChevronDown, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { GitHubIcon } from '@/components/icons/brand-icons';
import { Button } from '@/components/ui/button';
import { buildMailto } from '@/lib/support';
import { cn } from '@/lib/utils';
import { getNavigation } from '../../../config/navigation';

const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' });

const mode = import.meta.env.MODE === 'production' ? 'production' : 'development';
const navItems = getNavigation(mode);

export const HEADER_HEIGHT_CLASS = 'h-12';

type HeaderProps = {
  /**
   * Visual style variant for different page backgrounds.
   * - default: uses the site theme background
   * - light: forces a lighter header (useful on Explore's light canvas)
   */
  variant?: 'default' | 'light';
  className?: string;
};

const Header = ({ variant = 'default', className }: HeaderProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const textClass = variant === 'light' ? 'text-slate-900' : 'text-foreground';
  const hoverTextClass = variant === 'light' ? 'hover:text-slate-700' : 'hover:text-primary';
  const mutedTextClass = variant === 'light' ? 'text-slate-700' : 'text-foreground/80';

  const headerClasses = cn(
    'fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-lg',
    variant === 'light' ? 'bg-[#f4f4f4]/95 border-black/5' : 'bg-background/80 border-border/40',
    className,
  );

  const dropdownClasses = cn(
    'absolute top-full right-0 mt-2 w-48 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 border',
    variant === 'light' ? 'bg-white border-black/5' : 'bg-background border-border/40',
  );

  return (
    <header className={headerClasses}>
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className={`flex ${HEADER_HEIGHT_CLASS} items-center justify-between`}>
          {/* Logo */}
          <Link to="/" className="flex items-center">
            <img
              src={variant === 'light' ? '/wordmark.svg' : '/wordmark-black.svg'}
              alt="ProtSpace"
              className="h-10"
            />
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            {navItems.map((item) => {
              const isGitHub = item.icon === 'github';
              const linkClasses = isGitHub
                ? cn(textClass, hoverTextClass, 'transition-colors')
                : cn('text-sm font-medium transition-colors', textClass, hoverTextClass);

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
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'block px-4 py-2 text-sm first:rounded-t-lg last:rounded-b-lg transition-colors',
                            textClass,
                            hoverTextClass,
                            variant === 'light' ? 'hover:bg-black/5' : 'hover:bg-muted/50',
                          )}
                        >
                          {subItem.text}
                        </a>
                      ))}
                    </div>
                  </div>
                );
              }

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
                <a
                  key={item.text}
                  href={item.link}
                  className={linkClasses}
                  {...(item.target && {
                    target: item.target,
                    rel: 'noopener noreferrer',
                  })}
                  {...(isGitHub && { 'aria-label': 'View on GitHub' })}
                >
                  {isGitHub ? <GitHubIcon className="h-5 w-5" /> : item.text}
                </a>
              );
            })}

            {/* Feedback CTA */}
            <Button asChild size="sm">
              <a href={FEEDBACK_HREF}>
                <MessageSquareText />
                Feedback
              </a>
            </Button>
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={cn('md:hidden transition-colors', textClass, hoverTextClass)}
            aria-label="Toggle menu"
          >
            {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <nav className="md:hidden py-4 space-y-3 border-t border-border/40">
            {navItems.map((item) => {
              const isGitHub = item.icon === 'github';
              const linkClasses = isGitHub
                ? cn(
                    'flex items-center gap-2 py-2 text-sm font-medium transition-colors',
                    textClass,
                    hoverTextClass,
                  )
                : cn('block py-2 text-sm font-medium transition-colors', textClass, hoverTextClass);

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
                            target="_blank"
                            rel="noopener noreferrer"
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
                  {...(item.target && {
                    target: item.target,
                    rel: 'noopener noreferrer',
                  })}
                >
                  {isGitHub && <GitHubIcon className="h-4 w-4" />}
                  {item.text}
                </a>
              );
            })}

            {/* Feedback CTA */}
            <Button asChild size="sm" className="w-full mt-2">
              <a href={FEEDBACK_HREF} onClick={() => setIsMenuOpen(false)}>
                <MessageSquareText />
                Feedback
              </a>
            </Button>
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;

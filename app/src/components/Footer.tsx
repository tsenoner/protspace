import { GitHubIcon } from '@/components/icons/brand-icons';
import { DOCS_URL } from '@/config';
import { buildMailto } from '@/lib/support';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="border-t border-border/40 bg-card/30 backdrop-blur-sm py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Copyright */}
          <div className="text-sm text-muted-foreground text-center md:text-left">
            © 2025–{new Date().getFullYear()} ProtSpace contributors · Apache-2.0 License
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/tsenoner/protspace_web"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
            >
              <GitHubIcon />
              <span className="text-sm">GitHub</span>
            </a>
            <a
              href={DOCS_URL}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Documentation
            </a>
            <a
              href={buildMailto({ subject: 'ProtSpace contact' })}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Contact
            </a>
            <Link
              to="/privacy"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

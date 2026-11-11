import { Link } from 'react-router';
import { buildMailto } from '@/lib/support';

const NotFound = () => {
  const attemptedPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const reportHref = buildMailto({
    subject: '[Bug] Broken link',
    body: `I reached a 404 page.\n\nAttempted path: ${attemptedPath}`,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <Link to="/" className="text-link underline hover:text-link/80">
          Return to Home
        </Link>
        <p className="mt-4 text-sm text-muted-foreground">
          Think this is a broken link?{' '}
          <a href={reportHref} className="text-link underline hover:text-link/80">
            Email us
          </a>
          .
        </p>
      </div>
    </div>
  );
};

export default NotFound;

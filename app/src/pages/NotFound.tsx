import { Link } from 'react-router-dom';
import { buildMailto } from '@/lib/support';

const NotFound = () => {
  const attemptedPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const reportHref = buildMailto({
    subject: '[Bug] Broken link',
    body: `I reached a 404 page.\n\nAttempted path: ${attemptedPath}`,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-gray-600">Oops! Page not found</p>
        <Link to="/" className="text-blue-500 underline hover:text-blue-700">
          Return to Home
        </Link>
        <p className="mt-4 text-sm text-gray-500">
          Think this is a broken link?{' '}
          <a href={reportHref} className="text-blue-500 underline hover:text-blue-700">
            Email us
          </a>
          .
        </p>
      </div>
    </div>
  );
};

export default NotFound;

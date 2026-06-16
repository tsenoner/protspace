import { Link } from 'react-router-dom';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { SUPPORT_EMAIL, buildMailto } from '@/lib/support';

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-16">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mb-10">Last updated: March 30, 2026</p>

          <div className="space-y-8 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Overview</h2>
              <p>
                ProtSpace (
                <Link to="/" className="text-primary hover:underline">
                  protspace.app
                </Link>
                ) is an open-source tool for exploring protein embedding spaces. We are committed to
                protecting your privacy and collect as little data as possible.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Hosting</h2>
              <p>
                This website is hosted on{' '}
                <a
                  href="https://pages.github.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  GitHub Pages
                </a>
                . When you visit this site, GitHub may collect technical data such as your IP
                address in server logs. See{' '}
                <a
                  href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  GitHub's Privacy Statement
                </a>{' '}
                for details.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Web Analytics</h2>
              <p>
                We use{' '}
                <a
                  href="https://www.cloudflare.com/web-analytics/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Cloudflare Web Analytics
                </a>{' '}
                to understand how visitors use this site in aggregate. This service:
              </p>
              <ul className="list-disc list-inside mt-3 space-y-1.5 ml-2">
                <li>
                  Does <strong className="text-foreground">not</strong> set any cookies
                </li>
                <li>
                  Does <strong className="text-foreground">not</strong> use localStorage or other
                  client-side storage
                </li>
                <li>
                  Does <strong className="text-foreground">not</strong> fingerprint or track
                  individual visitors
                </li>
                <li>
                  Does <strong className="text-foreground">not</strong> track visitors across
                  websites
                </li>
              </ul>
              <p className="mt-3">
                The analytics beacon collects only aggregate, non-personal data: page URLs,
                referrers, browser type, screen size, and page load performance. No personal
                identifiers are stored or processed.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Processor:</strong> Cloudflare, Inc. (US),
                certified under the{' '}
                <a
                  href="https://www.dataprivacyframework.gov/participant/5666"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  EU-US Data Privacy Framework
                </a>
                .
                <br />
                <strong className="text-foreground">Legal basis:</strong> Legitimate interest in
                understanding website usage (Art. 6(1)(f) GDPR).
                <br />
                <strong className="text-foreground">Details:</strong>{' '}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Cloudflare Privacy Policy
                </a>
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Your Data</h2>
              <p>
                All data you load into ProtSpace (Parquet files, protein annotations) is processed
                entirely in your browser. No data is uploaded to any server. We have no access to
                your datasets.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Third-Party APIs</h2>
              <p>
                When you view 3D protein structures, requests are made to the{' '}
                <a
                  href="https://3d-beacons.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  3D-Beacons API
                </a>{' '}
                to fetch structural data. These requests contain only protein identifiers, not
                personal data.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">Contact</h2>
              <p>
                For privacy or data requests, email{' '}
                <a
                  href={buildMailto({ subject: 'Privacy request' })}
                  className="text-primary hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>{' '}
                or open an issue on{' '}
                <a
                  href="https://github.com/tsenoner/protspace_web"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  GitHub
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Privacy;

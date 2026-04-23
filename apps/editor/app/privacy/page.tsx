import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Archly and the archly.cloud platform.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link className="text-muted-foreground transition-colors hover:text-foreground" href="/">Home</Link>
            <span className="text-muted-foreground">/</span>
            <Link className="text-muted-foreground transition-colors hover:text-foreground" href="/terms">Terms of Service</Link>
            <span className="text-muted-foreground">|</span>
            <span className="font-medium text-foreground">Privacy Policy</span>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-12">
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <h1 className="mb-2 font-bold text-3xl">Privacy Policy</h1>
          <p className="mb-8 text-muted-foreground text-sm">Effective Date: February 20, 2026</p>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">1. Introduction</h2>
            <p className="text-foreground/90 leading-relaxed">
              Archly Inc. (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the
              Archly Editor and Platform at archly.cloud. This Privacy Policy explains how we collect,
              use, and protect your information when you use our services.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">2. Information We Collect</h2>
            <h3 className="mt-4 font-medium text-lg">Account Information</h3>
            <p className="text-foreground/90 leading-relaxed">When you create an account, we collect:</p>
            <ul className="list-disc space-y-2 pl-6 text-foreground/90">
              <li>Email address</li>
              <li>Name</li>
              <li>Profile picture/avatar</li>
              <li>OAuth provider data (from Google when you sign in with Google)</li>
            </ul>
            <h3 className="mt-4 font-medium text-lg">Project Data</h3>
            <p className="text-foreground/90 leading-relaxed">
              When you use the Platform, we store your projects, including 3D building designs,
              floor plans, and associated metadata.
            </p>
            <h3 className="mt-4 font-medium text-lg">Usage Analytics</h3>
            <p className="text-foreground/90 leading-relaxed">
              We use PostHog to collect anonymized usage data, including
              page views, performance metrics, and general usage patterns. This helps us improve the
              Platform.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">3. How We Use Your Information</h2>
            <p className="text-foreground/90 leading-relaxed">We use your information to:</p>
            <ul className="list-disc space-y-2 pl-6 text-foreground/90">
              <li>Provide and maintain your account</li>
              <li>Store and sync your projects across devices</li>
              <li>Improve our services based on usage patterns</li>
              <li>Send optional email notifications about new features and updates (you can opt out in settings)</li>
              <li>Respond to support requests</li>
              <li>Ensure platform security and prevent abuse</li>
            </ul>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">4. Data Storage</h2>
            <p className="text-foreground/90 leading-relaxed">
              Your data is stored using PostgreSQL on secure cloud
              infrastructure. We implement appropriate technical and organizational measures to
              protect your data.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">5. Third-Party Services</h2>
            <p className="text-foreground/90 leading-relaxed">We use the following third-party services to operate the Platform:</p>
            <ul className="list-disc space-y-2 pl-6 text-foreground/90">
              <li><strong>Google</strong> - OAuth authentication for sign-in</li>
              <li><strong>Cloudflare</strong> - CDN, R2 object storage for project assets</li>
              <li><strong>PostHog</strong> - Product analytics and usage insights</li>
            </ul>
            <p className="mt-4 text-foreground/90 leading-relaxed">
              Each of these services has their own privacy policies governing their handling of your data.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">6. Cookies</h2>
            <p className="text-foreground/90 leading-relaxed">We use minimal cookies necessary for the Platform to function:</p>
            <ul className="list-disc space-y-2 pl-6 text-foreground/90">
              <li><strong>Session cookies</strong> - Essential for authentication and keeping you signed in</li>
              <li><strong>Analytics cookies</strong> - Used by PostHog to collect anonymized usage data</li>
            </ul>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">7. Your Rights</h2>
            <p className="text-foreground/90 leading-relaxed">You have the right to:</p>
            <ul className="list-disc space-y-2 pl-6 text-foreground/90">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your project data</li>
              <li>Opt out of marketing communications</li>
            </ul>
            <p className="mt-4 text-foreground/90 leading-relaxed">
              To exercise any of these rights, please contact us at{' '}
              <a className="text-foreground underline hover:text-foreground/80" href="mailto:support@archly.cloud">support@archly.cloud</a>.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">8. Data Retention</h2>
            <p className="text-foreground/90 leading-relaxed">
              We retain your data for as long as your account is active. If you delete your account,
              we will delete your personal data and project data within 30 days, except where we are
              required by law to retain certain information.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">9. Children&apos;s Privacy</h2>
            <p className="text-foreground/90 leading-relaxed">
              The Platform is not intended for children under 13. We do not knowingly collect
              personal information from children under 13. If you believe we have collected such
              information, please contact us immediately.
            </p>
          </section>

          <section className="mb-8 space-y-4">
            <h2 className="font-semibold text-xl">10. Changes to This Policy</h2>
            <p className="text-foreground/90 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of material
              changes by posting the updated policy on the Platform. Your continued use of the
              Platform after changes are posted constitutes your acceptance of the revised policy.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold text-xl">11. Contact Us</h2>
            <p className="text-foreground/90 leading-relaxed">
              If you have questions about this Privacy Policy or how we handle your data, please
              contact us at{' '}
              <a className="text-foreground underline hover:text-foreground/80" href="mailto:support@archly.cloud">support@archly.cloud</a>.
            </p>
          </section>
        </article>
      </main>
    </div>
  )
}

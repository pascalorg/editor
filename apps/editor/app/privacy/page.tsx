import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Pascal Editor and the Pascal platform.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Home
            </Link>
            <span className="text-muted-foreground">/</span>
            <Link
              href="/terms"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Terms of Service
            </Link>
            <span className="text-muted-foreground">|</span>
            <span className="text-foreground font-medium">Privacy Policy</span>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-12">
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm mb-8">
            Effective Date: February 20, 2026
          </p>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">1. Introduction</h2>
            <p className="text-foreground/90 leading-relaxed">
              Pascal Group Inc. (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the Pascal Editor and
              Platform at pascal.app. This Privacy Policy explains how we collect, use, and
              protect your information when you use our services.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">2. Information We Collect</h2>

            <h3 className="text-lg font-medium mt-4">Account Information</h3>
            <p className="text-foreground/90 leading-relaxed">
              When you create an account, we collect:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Email address</li>
              <li>Name</li>
              <li>Profile picture/avatar</li>
              <li>OAuth provider data (from Google when you sign in with Google)</li>
            </ul>

            <h3 className="text-lg font-medium mt-4">Project Data</h3>
            <p className="text-foreground/90 leading-relaxed">
              When you use the Platform, we store your projects, including 3D building designs,
              floor plans, and associated metadata.
            </p>

            <h3 className="text-lg font-medium mt-4">Usage Analytics</h3>
            <p className="text-foreground/90 leading-relaxed">
              We use Vercel Analytics and Speed Insights to collect anonymized usage data,
              including page views, performance metrics, and general usage patterns. This helps
              us improve the Platform.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
            <p className="text-foreground/90 leading-relaxed">We use your information to:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Provide and maintain your account</li>
              <li>Store and sync your projects across devices</li>
              <li>Improve our services based on usage patterns</li>
              <li>Send optional email notifications about new features and updates (you can opt out in settings)</li>
              <li>Respond to support requests</li>
              <li>Ensure platform security and prevent abuse</li>
            </ul>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">4. Data Storage</h2>
            <p className="text-foreground/90 leading-relaxed">
              Your data is stored using Supabase (PostgreSQL database) on secure cloud
              infrastructure. We implement appropriate technical and organizational measures
              to protect your data.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">5. Third-Party Services</h2>
            <p className="text-foreground/90 leading-relaxed">
              We use the following third-party services to operate the Platform:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>
                <strong>Google</strong> - OAuth authentication for sign-in
              </li>
              <li>
                <strong>Vercel</strong> - Application hosting, analytics, and performance monitoring
              </li>
              <li>
                <strong>Supabase</strong> - Database hosting and authentication infrastructure
              </li>
            </ul>
            <p className="text-foreground/90 leading-relaxed mt-4">
              Each of these services has their own privacy policies governing their handling
              of your data.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">6. Cookies</h2>
            <p className="text-foreground/90 leading-relaxed">
              We use minimal cookies necessary for the Platform to function:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>
                <strong>Session cookies</strong> - Essential for authentication and keeping you
                signed in
              </li>
              <li>
                <strong>Analytics cookies</strong> - Used by Vercel Analytics to collect
                anonymized usage data
              </li>
            </ul>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">7. Your Rights</h2>
            <p className="text-foreground/90 leading-relaxed">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Export your project data</li>
              <li>Opt out of marketing communications</li>
            </ul>
            <p className="text-foreground/90 leading-relaxed mt-4">
              To exercise any of these rights, please contact us at{' '}
              <a
                href="mailto:support@pascal.app"
                className="text-foreground underline hover:text-foreground/80"
              >
                support@pascal.app
              </a>
              .
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">8. Data Retention</h2>
            <p className="text-foreground/90 leading-relaxed">
              We retain your data for as long as your account is active. If you delete your
              account, we will delete your personal data and project data within 30 days,
              except where we are required by law to retain certain information.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">9. Children&apos;s Privacy</h2>
            <p className="text-foreground/90 leading-relaxed">
              The Platform is not intended for children under 13. We do not knowingly collect
              personal information from children under 13. If you believe we have collected
              such information, please contact us immediately.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">10. Changes to This Policy</h2>
            <p className="text-foreground/90 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of
              material changes by posting the updated policy on the Platform. Your continued
              use of the Platform after changes are posted constitutes your acceptance of the
              revised policy.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">11. Contact Us</h2>
            <p className="text-foreground/90 leading-relaxed">
              If you have questions about this Privacy Policy or how we handle your data,
              please contact us at{' '}
              <a
                href="mailto:support@pascal.app"
                className="text-foreground underline hover:text-foreground/80"
              >
                support@pascal.app
              </a>
              .
            </p>
          </section>
        </article>
      </main>
    </div>
  )
}

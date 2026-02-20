import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service for Pascal Editor and the Pascal platform.',
}

export default function TermsPage() {
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
            <span className="text-foreground font-medium">Terms of Service</span>
            <span className="text-muted-foreground">|</span>
            <Link
              href="/privacy"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy Policy
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-6 py-12">
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground text-sm mb-8">
            Effective Date: February 20, 2026
          </p>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">1. Introduction</h2>
            <p className="text-foreground/90 leading-relaxed">
              Welcome to Pascal Editor (&quot;Editor&quot;) and the Pascal platform at pascal.app
              (&quot;Platform&quot;), operated by Pascal Group Inc. (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
              By accessing or using our services, you agree to these Terms of Service.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">2. The Editor and Platform</h2>
            <p className="text-foreground/90 leading-relaxed">
              The Pascal Editor is open-source software released under the MIT License.
              You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell
              copies of the Editor software in accordance with the MIT License terms.
            </p>
            <p className="text-foreground/90 leading-relaxed">
              The Pascal platform (pascal.app) and its associated services, including user accounts,
              cloud storage, and project hosting, are proprietary services owned and operated by
              Pascal Group Inc. These Terms govern your use of the Platform.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">3. Accounts and Authentication</h2>
            <p className="text-foreground/90 leading-relaxed">
              To use certain features of the Platform, you must create an account. We use
              Google OAuth and magic link email authentication through Supabase. You are
              responsible for maintaining the security of your account credentials and for
              all activities that occur under your account.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">4. Acceptable Use</h2>
            <p className="text-foreground/90 leading-relaxed">You agree not to:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Use the Platform for any unlawful purpose or in violation of any applicable laws</li>
              <li>Upload, share, or distribute content that infringes intellectual property rights</li>
              <li>Attempt to gain unauthorized access to the Platform or its systems</li>
              <li>Interfere with or disrupt the Platform&apos;s infrastructure</li>
              <li>Upload malicious code, viruses, or harmful content</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Use the Platform to send spam or unsolicited communications</li>
            </ul>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">5. Your Content and Intellectual Property</h2>
            <p className="text-foreground/90 leading-relaxed">
              You retain full ownership of all content, projects, and data you create or upload
              to the Platform (&quot;Your Content&quot;). By using the Platform, you grant us a limited
              license to store, display, and transmit Your Content solely to provide our services
              to you.
            </p>
            <p className="text-foreground/90 leading-relaxed">
              We do not claim any ownership rights over Your Content. You may export or delete
              Your Content at any time.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">6. Platform Ownership</h2>
            <p className="text-foreground/90 leading-relaxed">
              The Platform, including its design, features, and proprietary code, is owned by
              Pascal Group Inc. and protected by intellectual property laws. While the Editor
              source code is open-source under the MIT License, the Platform services, branding,
              and infrastructure remain our proprietary property.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">7. Account Termination</h2>
            <p className="text-foreground/90 leading-relaxed">
              We reserve the right to suspend or terminate your account if you violate these
              Terms or engage in conduct that we determine is harmful to the Platform or other
              users. You may also delete your account at any time by contacting us at{' '}
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
            <h2 className="text-xl font-semibold">8. Disclaimer of Warranties</h2>
            <p className="text-foreground/90 leading-relaxed">
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY
              KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES
              OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p className="text-foreground/90 leading-relaxed">
              We do not warrant that the Platform will be uninterrupted, error-free, or free
              of harmful components.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">9. Limitation of Liability</h2>
            <p className="text-foreground/90 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, PASCAL GROUP INC. SHALL NOT BE LIABLE
              FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
              INCLUDING LOSS OF DATA, PROFITS, OR GOODWILL, ARISING FROM YOUR USE OF THE
              PLATFORM.
            </p>
          </section>

          <section className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">10. Changes to Terms</h2>
            <p className="text-foreground/90 leading-relaxed">
              We may update these Terms from time to time. We will notify you of material
              changes by posting the updated Terms on the Platform. Your continued use of the
              Platform after changes are posted constitutes your acceptance of the revised Terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">11. Contact Us</h2>
            <p className="text-foreground/90 leading-relaxed">
              If you have questions about these Terms, please contact us at{' '}
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

import { Analytics } from '@vercel/analytics/next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

import { DevTools } from '@/components/dev/dev-tools'
import { MotionProvider } from '@/components/motion/motion-provider'
import { BrandIcon } from '@/components/site/brand-icon'
import { SiteHeader } from '@/components/site/site-header'
import { ThemeProvider } from '@/components/site/theme-provider'

const SITE_URL = 'https://lingo.pascal.app'
const TITLE = 'lingo: Make forms easier, LLM tools safer.'
const DESCRIPTION =
  'Make forms easier, LLM tools safer. The library parses what humans type and what models emit: quantities, units, dates, and ranges into canonical, validated values. Zero dependencies.'
const THEME_INIT_SCRIPT = `
(() => {
  try {
    const storedTheme = window.localStorage.getItem('theme');
    const theme =
      storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : 'system';
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch {}
})();
`

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s | lingo',
  },
  description: DESCRIPTION,
  alternates: {
    types: {
      'text/markdown': '/llms.md',
      'text/plain': '/llms.txt',
    },
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'lingo',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      className={`h-full antialiased ${GeistSans.variable} ${GeistMono.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <Script id="lingo-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        <DevTools />
        <ThemeProvider>
          <MotionProvider>
            <a
              className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              href="#main"
            >
              Skip to content
            </a>
            <SiteHeader />
            <main className="flex-1" id="main">
              {children}
            </main>
            {/* No rule above the footer: spacing separates it; a hard border
              reads harsh against the shadow-ring surface system. */}
            <footer className="mt-12">
              <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 pt-4 pb-10 text-muted-foreground/80 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
                <p>MIT · zero deps</p>
                <nav aria-label="Footer" className="flex flex-wrap gap-3 font-mono text-xs">
                  <a
                    className="inline-flex items-center gap-1.5 rounded-sm outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    href="https://github.com/pascalorg/lingo"
                  >
                    <BrandIcon brand="github" className="opacity-65" data-icon="inline-start" />
                    GitHub
                  </a>
                  <a
                    className="inline-flex items-center gap-1.5 rounded-sm outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    href="https://www.npmjs.com/package/@pascal-app/lingo"
                  >
                    <BrandIcon brand="npm" className="opacity-65" data-icon="inline-start" />
                    npm
                  </a>
                  {/* Plain <a>: agent routes are served as route handlers, not client-nav pages. */}
                  <a
                    className="transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground"
                    href="/llms.txt"
                  >
                    llms.txt
                  </a>
                </nav>
              </div>
            </footer>
          </MotionProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}

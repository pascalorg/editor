import type { Metadata } from 'next'
import Script from 'next/script'
import localFont from 'next/font/local'
import { Barlow } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { VercelToolbar } from '@vercel/toolbar/next'
import { Agentation } from 'agentation'
import { UsernameGate } from '@/features/community/components/username-gate'
import { siteConfig } from './seo'
import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: '%s | Pascal Editor',
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [{ name: 'Pascal', url: 'https://pascal.app' }],
  creator: 'Pascal',
  publisher: 'Pascal',
  alternates: {
    canonical: '/',
  },
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    images: [{ url: siteConfig.ogImage, alt: 'Pascal Editor' }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    creator: siteConfig.twitterHandle,
    images: [siteConfig.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const shouldShowToolbar = process.env.NODE_ENV === 'development'

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${barlow.variable}`}>
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            src="//unpkg.com/react-scan/dist/auto.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body className="font-sans">
        <UsernameGate>{children}</UsernameGate>
        <Analytics />
        <SpeedInsights />
        {shouldShowToolbar && <VercelToolbar />}
        {process.env.NODE_ENV === 'development' && <Agentation />}
      </body>
    </html>
  )
}

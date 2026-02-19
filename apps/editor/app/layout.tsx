import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { VercelToolbar } from '@vercel/toolbar/next'
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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <UsernameGate>{children}</UsernameGate>
        <Analytics />
        <SpeedInsights />
        {shouldShowToolbar && <VercelToolbar />}
      </body>
    </html>
  )
}

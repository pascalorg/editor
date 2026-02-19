import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { VercelToolbar } from '@vercel/toolbar/next'
import { UsernameGate } from '@/features/community/components/username-gate'
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
  title: 'Pascal Editor',
  description: 'Open-source 3D building editor',
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

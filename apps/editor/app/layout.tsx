import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import { DM_Sans } from 'next/font/google'
import localFont from 'next/font/local'
import { ClientBootstrap } from './client-bootstrap'
import { CookieConsent } from '@/components/cookie-consent'
import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

// The Modernist system's face. `latin-ext` carries the Turkish ı, ğ and ş.
const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-dm-sans',
  display: 'swap',
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const enableDevDiagnostics =
    process.env.NODE_ENV === 'development' && process.env.PASCAL_DEV_DIAGNOSTICS === '1'

  return (
    <html
      className={`dark ${geistSans.variable} ${geistMono.variable} ${GeistPixelSquare.variable} ${dmSans.variable}`}
      lang="tr"
      suppressHydrationWarning
    >
      <body className="font-sans">
        <ClientBootstrap enableDevDiagnostics={enableDevDiagnostics}>{children}</ClientBootstrap>
        {enableDevDiagnostics && <Agentation />}
        <CookieConsent />
      </body>
    </html>
  )
}

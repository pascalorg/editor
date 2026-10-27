import { registerBundledLocales } from '@pascal-app/editor/locales'
import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import { Barlow } from 'next/font/google'
import localFont from 'next/font/local'
import { headers } from 'next/headers'
import { registerDevLocales } from '@/lib/dev-locales'
import { PASCAL_LOCALE_HEADER, resolveUiLocale } from '@/lib/ui-locale'
import { ClientBootstrap } from './client-bootstrap'
import './globals.css'

registerBundledLocales()
registerDevLocales()

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const enableDevDiagnostics =
    process.env.NODE_ENV === 'development' && process.env.PASCAL_DEV_DIAGNOSTICS === '1'
  const locale = resolveUiLocale((await headers()).get(PASCAL_LOCALE_HEADER))

  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} ${GeistPixelSquare.variable} ${barlow.variable}`}
      lang={locale}
    >
      <body className="font-sans">
        <ClientBootstrap enableDevDiagnostics={enableDevDiagnostics} locale={locale}>
          {children}
        </ClientBootstrap>
        {enableDevDiagnostics && <Agentation />}
      </body>
    </html>
  )
}

import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import { Barlow } from 'next/font/google'
import localFont from 'next/font/local'
import { ClientBootstrap } from './client-bootstrap'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const enableDevDiagnostics =
    process.env.NODE_ENV === 'development' && process.env.PASCAL_DEV_DIAGNOSTICS === '1'

  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} ${GeistPixelSquare.variable} ${barlow.variable}`}
      lang="en"
    >
      <body className="font-sans">
        <ClientBootstrap enableDevDiagnostics={enableDevDiagnostics}>{children}</ClientBootstrap>
        {enableDevDiagnostics && <Agentation />}
      </body>
    </html>
  )
}

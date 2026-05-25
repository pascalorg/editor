import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import localFont from 'next/font/local'
import '@/i18n/init'
import { ClientBootstrap } from './client-bootstrap'
import './globals.css'

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      className={`${geistMono.variable} ${GeistPixelSquare.variable}`}
      lang="zh-CN"
    >
      <body className="font-sans">
        <ClientBootstrap>{children}</ClientBootstrap>
        {process.env.NODE_ENV === 'development' &&
          process.env.NEXT_PUBLIC_ENABLE_AGENTATION === 'true' && <Agentation />}
      </body>
    </html>
  )
}

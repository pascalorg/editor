import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import localFont from 'next/font/local'
import Script from 'next/script'
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
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            crossOrigin="anonymous"
            src="//unpkg.com/react-scan/dist/auto.global.js"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body className="font-sans">
        <ClientBootstrap>{children}</ClientBootstrap>
        {process.env.NODE_ENV === 'development' && <Agentation />}
      </body>
    </html>
  )
}

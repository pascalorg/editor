import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import { Inter, Barlow } from 'next/font/google'
import localFont from 'next/font/local'
import Script from 'next/script'
import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './Providers'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
})

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
  title: {
    default: 'Archly — Collaborative 3D Building Design',
    template: '%s | Archly',
  },
  description:
    'Design, collaborate, and deploy 3D buildings in real-time. Archly combines WebGPU performance with seamless team workflows for architecture, real estate, and construction teams.',
  keywords: [
    '3D building design',
    'collaborative architecture',
    'WebGPU editor',
    'real-time collaboration',
    'BIM',
    'spatial design platform',
  ],
  openGraph: {
    title: 'Archly — Collaborative 3D Building Design',
    description:
      'Where teams build in 3D. Real-time collaborative spatial design for architecture, real estate, and construction.',
    url: 'https://archly.cloud',
    siteName: 'Archly',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Archly — Collaborative 3D Building Design',
    description:
      'Where teams build in 3D. Real-time collaborative spatial design.',
  },
  metadataBase: new URL('https://archly.cloud'),
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} ${GeistPixelSquare.variable} ${barlow.variable}`}
      lang="en"
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
        <Providers>
          {children}
        </Providers>
        {process.env.NODE_ENV === 'development' && <Agentation />}
      </body>
    </html>
  )
}

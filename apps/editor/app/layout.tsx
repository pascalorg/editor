import { readEnv } from '@pascal-app/mcp/env'
import { Agentation } from 'agentation'
import { GeistPixelSquare } from 'geist/font/pixel'
import type { Metadata } from 'next'
import { Barlow } from 'next/font/google'
import localFont from 'next/font/local'
import { ClientBootstrap } from './client-bootstrap'
import './globals.css'

/**
 * No page in this app may be statically prerendered: the host's CDN caches
 * static HTML for a year, and every redeploy renames the hashed assets that
 * HTML points at — so a cached page comes back unstyled after the next
 * release. Dynamic rendering makes Next send no-cache headers instead. The
 * hashed /_next/static assets themselves stay long-cached, which is safe.
 */
export const dynamic = 'force-dynamic'

/**
 * "System" is the default and has to hold on the very first request, before any
 * cookie exists and before React runs. The server renders a guess into every
 * [data-dt-theme] wrapper; this corrects it in place.
 */
const THEME_BOOTSTRAP = `(function(){try{
var m=document.cookie.match(/(?:^|; )digitaltwin_theme_choice=([^;]*)/);
var c=m?decodeURIComponent(m[1]):null;
try{var s=localStorage.getItem('digitaltwin_theme');if(s==='system'||s==='light'||s==='dark')c=s}catch(e){}
var r=(c==='light'||c==='dark')?c:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var n=document.querySelectorAll('[data-dt-theme]');
for(var i=0;i<n.length;i++)n[i].setAttribute('data-dt-theme',r);
document.documentElement.setAttribute('data-dt-theme',r);
document.cookie='digitaltwin_theme='+r+';path=/;max-age=31536000;samesite=lax';
}catch(e){}})()`

export const metadata: Metadata = {
  title: {
    default: 'DigitalTwin Editor',
    template: '%s | DigitalTwin',
  },
  description: '3D building editor',
}

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
    process.env.NODE_ENV === 'development' && readEnv(process.env, 'DEV_DIAGNOSTICS') === '1'

  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} ${GeistPixelSquare.variable} ${barlow.variable}`}
      lang="en"
    >
      <body className="font-sans">
        <ClientBootstrap enableDevDiagnostics={enableDevDiagnostics}>{children}</ClientBootstrap>
        {enableDevDiagnostics && <Agentation />}
        {/* Runs after the theme wrappers are parsed and before React hydrates,
            so a first visit with no stored choice paints in the operating
            system's theme instead of flashing the server's guess. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme resolution has to be inline
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
      </body>
    </html>
  )
}

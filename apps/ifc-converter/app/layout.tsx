import type { ReactNode } from 'react'
import { ClientBootstrap } from './client-bootstrap'
import { I18nProvider, useLocale } from '@/lib/i18n'
import './globals.css'

export const metadata = {
  title: 'IFC → Pascal Converter',
  description: 'Convert IFC building models into Pascal scene-graph JSON.',
}

function HtmlLangSync({ children }: { children: ReactNode }) {
  const { locale } = useLocale()
  // Mirror the active locale on <html lang> so screen readers and
  // search engines see the correct language after hydration.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
  return <>{children}</>
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <I18nProvider>
          <HtmlLangSync>
            <ClientBootstrap>{children}</ClientBootstrap>
          </HtmlLangSync>
        </I18nProvider>
      </body>
    </html>
  )
}

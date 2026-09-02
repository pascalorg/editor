import type { ReactNode } from 'react'
import { ClientBootstrap } from './client-bootstrap'
import { HtmlLangSync } from './html-lang-sync'
import { I18nProvider } from '@/lib/i18n'
import './globals.css'

export const metadata = {
  title: 'IFC → Pascal Converter',
  description: 'Convert IFC building models into Pascal scene-graph JSON.',
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

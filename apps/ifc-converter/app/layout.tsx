import type { ReactNode } from 'react'
import { ClientBootstrap } from './client-bootstrap'
import { I18nProvider } from '@/lib/i18n'
import './globals.css'

export const metadata = {
  title: 'IFC → Pascal Converter',
  description: 'Convert IFC building models into Pascal scene-graph JSON.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <ClientBootstrap>{children}</ClientBootstrap>
        </I18nProvider>
      </body>
    </html>
  )
}

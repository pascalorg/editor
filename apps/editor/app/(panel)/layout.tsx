import { AppProviders } from '@panel/components/app-providers'
import { ErrorReporter } from '@panel/components/error-reporter'
import type { Lang, Theme } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import '@panel/globals.css'

export const metadata: Metadata = {
  title: 'Console',
  description: 'DigitalTwin — authentication and administration console.',
}

/**
 * The console's root layout, adapted to live inside the editor app: the host
 * owns <html>/<body> and the fonts (same --font-barlow/--font-geist-mono
 * variables), so the panel's theme attribute moves from <html> to a wrapper.
 * Every panel token is defined on [data-dt-theme] — not :root — precisely so
 * the theme travels with the subtree instead of leaking into the editor.
 *
 * Reading theme and language from cookies server-side keeps the first paint
 * from flashing the wrong theme.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const theme: Theme = jar.get('digitaltwin_theme')?.value === 'light' ? 'light' : 'dark'
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'

  return (
    <div className="min-h-screen bg-shell text-fg" data-dt-theme={theme} lang={lang}>
      <AppProviders initialLang={lang} initialTheme={theme}>
        <ErrorReporter />
        {children}
      </AppProviders>
    </div>
  )
}

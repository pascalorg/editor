import { translate } from '@pascal-app/editor/i18n'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { ServerLocalizedContent } from '@/components/server-localized-content'
import { SettingsClientPage } from './client-page'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const locale = (await cookies()).get('pascal-locale')?.value === 'en' ? 'en' : 'tr'
  const t = (text: string) => translate(text, locale)

  return (
    <ServerLocalizedContent locale={locale}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
          <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
            <nav className="flex items-center gap-4 text-sm">
              <Link
                className="text-muted-foreground transition-colors hover:text-foreground"
                href="/"
              >
                {t('Home')}
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="font-medium text-foreground">{t('Account Settings')}</span>
            </nav>
          </div>
        </header>

        <main className="container mx-auto max-w-5xl px-6 py-12">
          <SettingsClientPage />
        </main>
      </div>
    </ServerLocalizedContent>
  )
}

import { translate } from '@pascal-app/editor/i18n'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { Suspense } from 'react'
import { ServerLocalizedContent } from '@/components/server-localized-content'
import { ResetPasswordClientPage } from './client-page'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage() {
  const locale = (await cookies()).get('pascal-locale')?.value === 'en' ? 'en' : 'tr'
  const t = (text: string) => translate(text, locale)

  return (
    <ServerLocalizedContent locale={locale}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-border border-b">
          <div className="container mx-auto flex items-center gap-4 px-6 py-4 text-sm">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/"
            >
              {t('Home')}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{t('Reset password')}</span>
          </div>
        </header>

        <main className="container mx-auto max-w-md px-6 py-16">
          <Suspense fallback={null}>
            <ResetPasswordClientPage />
          </Suspense>
        </main>
      </div>
    </ServerLocalizedContent>
  )
}

import '@panel/globals.css'
import { dictionaryFor } from '@panel/lib/i18n'
import type { Lang } from '@panel/lib/types'
import { cookies } from 'next/headers'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The two pages anyone may read without an account: the guide and the
 * changelog. They wear the console's skin but carry none of its machinery —
 * no session, no providers — because the whole point is that a signed-out
 * visitor can reach them from the sign-in screen.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const theme = jar.get('digitaltwin_theme')?.value === 'light' ? 'light' : 'dark'
  const t = dictionaryFor(lang)

  return (
    <div className="min-h-screen bg-shell text-fg" data-dt-theme={theme} lang={lang}>
      <header className="border-border border-b bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-[14px]">
          <Link
            className="flex items-center gap-[10px] font-semibold text-[15px] text-fg no-underline tracking-[-0.01em]"
            href="/"
          >
            <span className="h-[22px] w-[22px] rounded-[6px] bg-brand" />
            DigitalTwin
          </Link>
          <nav className="flex items-center gap-4 text-[12.5px]">
            <Link className="text-muted-fg no-underline hover:text-fg" href="/guides">
              {t.qlGuides}
            </Link>
            <Link className="text-muted-fg no-underline hover:text-fg" href="/changelog">
              {t.qlChangelog}
            </Link>
            <Link
              className="rounded-[7px] border border-border px-[11px] py-[5px] font-medium text-fg no-underline hover:bg-hover"
              href="/signin"
            >
              {t.signIn}
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  )
}

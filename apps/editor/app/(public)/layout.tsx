import '@panel/globals.css'
import { dictionaryFor } from '@panel/lib/i18n'
import type { Lang } from '@panel/lib/types'
import { cookies } from 'next/headers'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { BrandLockup } from '@/components/brand-mark'
import { LangSwitch } from '@/components/public/lang-switch'
import { ThemeSwitch } from '@/components/public/theme-switch'
import { authAvailable } from '@/lib/auth/db'
import { getSessionUser } from '@/lib/auth/session'

/**
 * The shell for the two pages anyone may read without an account: the
 * documentation and the changelog. It wears the product's skin but carries
 * none of the console's machinery — no session, no providers — because the
 * whole point is that a signed-out visitor can reach it from the sign-in
 * screen.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const theme = jar.get('digitaltwin_theme')?.value === 'light' ? 'light' : 'dark'
  const t = dictionaryFor(lang)

  // These pages are readable by anyone, so the call to action has to match who
  // is reading: a stranger is offered the door, an editor the editor, and a
  // view-only account the scenes it may look at.
  const user = authAvailable() ? await getSessionUser() : null
  const cta =
    user === null
      ? { href: '/signin', label: t.signIn }
      : user.role === 'viewer'
        ? { href: '/scenes', label: lang === 'tr' ? 'Projelerim' : 'My projects' }
        : { href: '/', label: lang === 'tr' ? 'Editörü aç' : 'Open the editor' }

  return (
    <div className="min-h-screen bg-bg text-fg" data-dt-theme={theme} lang={lang}>
      <header className="sticky top-0 z-20 border-border border-b bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-[13px]">
          <Link className="text-fg no-underline" href="/guides">
            <BrandLockup />
          </Link>

          <nav className="flex items-center gap-[14px] text-[13px]">
            <Link className="text-muted-fg no-underline hover:text-fg" href="/guides">
              {lang === 'tr' ? 'Kılavuz' : 'Guides'}
            </Link>
            <Link className="text-muted-fg no-underline hover:text-fg" href="/changelog">
              {lang === 'tr' ? 'Sürüm notları' : 'Changelog'}
            </Link>
            <LangSwitch />
            <ThemeSwitch
              labels={{
                system: t.themeSystem,
                light: t.themeLight,
                dark: t.themeDark,
              }}
            />
            <Link
              className="rounded-full bg-brand px-[13px] py-[6px] font-medium text-[12.5px] text-[#18181b] no-underline transition-opacity hover:opacity-90"
              href={cta.href}
            >
              {cta.label}
            </Link>
          </nav>
        </div>
      </header>

      {children}

      <footer className="border-border border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12px] text-muted-fg">
          <span>DigitalTwin — {t.internalOnly}</span>
          <span className="flex gap-4">
            <Link className="text-muted-fg no-underline hover:text-fg" href="/terms">
              {lang === 'tr' ? 'Şartlar' : 'Terms'}
            </Link>
            <Link className="text-muted-fg no-underline hover:text-fg" href="/privacy">
              {lang === 'tr' ? 'Gizlilik' : 'Privacy'}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}

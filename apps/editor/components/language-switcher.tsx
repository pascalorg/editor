'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '../i18n/navigation'
import { routing } from '../i18n/routing'

export function LanguageSwitcher() {
  const locale = useLocale()
  const t = useTranslations('locale')
  const router = useRouter()
  const pathname = usePathname()

  const otherLocale = routing.locales.find((l) => l !== locale) ?? routing.defaultLocale

  const handleSwitch = () => {
    router.replace(pathname, { locale: otherLocale })
  }

  return (
    <button
      aria-label={`Switch to ${t(otherLocale as 'en' | 'he')}`}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-background/95 px-3 py-2 font-medium text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent/90"
      onClick={handleSwitch}
      type="button"
    >
      <span className="text-base leading-none">{otherLocale === 'he' ? '🇮🇱' : '🇺🇸'}</span>
      <span>{t(otherLocale as 'en' | 'he')}</span>
    </button>
  )
}

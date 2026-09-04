'use client'

import { useCallback, useEffect, useState } from 'react'

const COOKIE = 'digitaltwin_lang'

/**
 * English ⇄ Turkish, on the pages that render outside the console's providers.
 * The cookie is the same one the console reads, so switching here carries over
 * to the signed-in application and back.
 *
 * The page is re-requested rather than re-rendered: the copy is chosen on the
 * server, which is what keeps the first paint in the right language.
 */
export function LangSwitch() {
  const [lang, setLang] = useState<'en' | 'tr'>('en')

  useEffect(() => {
    let stored: string | null | undefined
    try {
      stored = localStorage.getItem(COOKIE)
    } catch {
      /* ignore */
    }
    stored ??= document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.split('=')[1]
    setLang(stored === 'tr' ? 'tr' : 'en')
  }, [])

  const toggle = useCallback(() => {
    const next = lang === 'en' ? 'tr' : 'en'
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    // The console takes localStorage as the authority over the cookie, so both
    // are written — otherwise signing in would put the language back.
    try {
      localStorage.setItem(COOKIE, next)
    } catch {
      /* private mode — the cookie still carries the choice */
    }
    window.location.reload()
  }, [lang])

  return (
    <button
      aria-label={lang === 'en' ? 'Türkçe' : 'English'}
      className="flex h-[26px] cursor-pointer items-center rounded-full border border-border bg-surface px-[9px] font-mono text-[10.5px] text-muted-fg transition-colors hover:text-fg"
      onClick={toggle}
      title={lang === 'en' ? 'Türkçe' : 'English'}
      type="button"
    >
      {lang === 'en' ? 'EN' : 'TR'}
    </button>
  )
}

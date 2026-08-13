'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type UiLocale = 'tr' | 'en'
export type UiTheme = 'dark' | 'light'

interface UiPreferencesState {
  locale: UiLocale
  theme: UiTheme
  setLocale: (locale: UiLocale) => void
  setTheme: (theme: UiTheme) => void
}

export const UI_PREFERENCES_STORAGE_KEY = 'pascal-ui-preferences'

export const useUiPreferences = create<UiPreferencesState>()(
  persist(
    (set) => ({
      locale: 'tr',
      theme: 'dark',
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: UI_PREFERENCES_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ locale, theme }) => ({ locale, theme }),
    },
  ),
)

function applyPreferences(locale: UiLocale, theme: UiTheme) {
  const root = document.documentElement
  root.lang = locale
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = theme

  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `pascal-locale=${locale}; path=/; max-age=${maxAge}; samesite=lax`
  document.cookie = `pascal-theme=${theme}; path=/; max-age=${maxAge}; samesite=lax`
}

export function UiPreferencesSync() {
  const locale = useUiPreferences((state) => state.locale)
  const theme = useUiPreferences((state) => state.theme)

  useEffect(() => {
    void useUiPreferences.persist.rehydrate()
  }, [])

  useEffect(() => {
    applyPreferences(locale, theme)
  }, [locale, theme])

  return null
}

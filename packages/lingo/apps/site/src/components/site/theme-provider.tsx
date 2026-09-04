'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type ThemeMode = 'system' | 'light' | 'dark'
type ResolvedTheme = 'light' | 'dark'

type ThemeContextValue = {
  mounted: boolean
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
  theme: ThemeMode
}

const STORAGE_KEY = 'theme'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light'
}

function applyTheme(theme: ThemeMode): ResolvedTheme {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme
  const root = document.documentElement
  root.classList.toggle('dark', resolvedTheme === 'dark')
  root.style.colorScheme = resolvedTheme
  return resolvedTheme
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY)
    const initialTheme = isThemeMode(storedTheme) ? storedTheme : 'system'
    setThemeState(initialTheme)
    setResolvedTheme(applyTheme(initialTheme))
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) {
      return
    }

    window.localStorage.setItem(STORAGE_KEY, theme)
    setResolvedTheme(applyTheme(theme))

    if (theme !== 'system') {
      return
    }

    const media = window.matchMedia(SYSTEM_DARK_QUERY)
    const handleChange = () => {
      setResolvedTheme(applyTheme('system'))
    }

    media.addEventListener('change', handleChange)
    return () => {
      media.removeEventListener('change', handleChange)
    }
  }, [mounted, theme])

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme)
  }, [])

  const value = useMemo(
    () => ({ mounted, resolvedTheme, setTheme, theme }),
    [mounted, resolvedTheme, setTheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>')
  }
  return context
}

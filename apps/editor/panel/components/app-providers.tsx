'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANG, dictionaryFor, type Dictionary } from '@panel/lib/i18n';
import type { Lang, Theme } from '@panel/lib/types';

const THEME_KEY = 'digitaltwin_theme';
const LANG_KEY = 'digitaltwin_lang';

interface AppShell {
  theme: Theme;
  lang: Lang;
  t: Dictionary;
  toggleTheme: () => void;
  toggleLang: () => void;
  setTheme: (theme: Theme) => void;
  setLang: (lang: Lang) => void;
}

const Ctx = createContext<AppShell | null>(null);

export function useApp(): AppShell {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp must be used inside <AppProviders>');
  return value;
}

/** Convenience for components that only need the dictionary. */
export function useT(): Dictionary {
  return useApp().t;
}

export function AppProviders({
  initialTheme,
  initialLang,
  children,
}: {
  initialTheme: Theme;
  initialLang: Lang;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [lang, setLangState] = useState<Lang>(initialLang);

  /**
   * The `lang` attribute drives screen-reader pronunciation, hyphenation and
   * font selection, so it tracks the dictionary.
   *
   * It is deliberately NOT what capitalisation depends on. `text-transform:
   * uppercase` is specified to follow the document language, but Chromium still
   * renders İŞLEMCİ as ISLEMCI under lang="tr" — so every uppercase label goes
   * through <Caps>, which uses toLocaleUpperCase and cannot silently regress.
   */
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.dtTheme = theme;
  }, [lang, theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
      document.cookie = `${THEME_KEY}=${next};path=/;max-age=31536000;samesite=lax`;
    } catch {
      /* private mode — the in-memory state still works for this tab */
    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
      document.cookie = `${LANG_KEY}=${next};path=/;max-age=31536000;samesite=lax`;
    } catch {
      /* ignore */
    }
  }, []);

  // Reconcile once on mount: the server rendered from the cookie, but a stored
  // preference or the OS setting may disagree with it.
  useEffect(() => {
    let storedTheme: string | null = null;
    let storedLang: string | null = null;
    try {
      storedTheme = localStorage.getItem(THEME_KEY);
      storedLang = localStorage.getItem(LANG_KEY);
    } catch {
      /* ignore */
    }

    if (storedTheme === 'dark' || storedTheme === 'light') {
      if (storedTheme !== theme) setTheme(storedTheme);
    } else if (!document.cookie.includes(`${THEME_KEY}=`)) {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const fallback: Theme = prefersLight ? 'light' : 'dark';
      if (fallback !== theme) setTheme(fallback);
    }

    if ((storedLang === 'en' || storedLang === 'tr') && storedLang !== lang) setLang(storedLang);
    // Mount-only on purpose — this reconciles the server guess, it does not track changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AppShell>(
    () => ({
      theme,
      lang,
      t: dictionaryFor(lang),
      toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      toggleLang: () => setLang(lang === 'en' ? 'tr' : 'en'),
      setTheme,
      setLang,
    }),
    [theme, lang, setTheme, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { THEME_KEY, LANG_KEY, DEFAULT_LANG };

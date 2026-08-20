export type LocaleChoice = 'auto' | 'en' | 'es' | 'fr' | 'pt' | 'zh' | 'ja' | 'en-gb'

export interface LocaleMeta {
  flag: string
  label: string
  value: LocaleChoice
}

export const LOCALE_META: readonly LocaleMeta[] = [
  { value: 'auto', flag: '🌐', label: 'Auto' },
  { value: 'en', flag: '🇺🇸', label: 'English' },
  { value: 'es', flag: '🇪🇸', label: 'Español' },
  { value: 'fr', flag: '🇫🇷', label: 'Français' },
  { value: 'pt', flag: '🇧🇷', label: 'Português' },
  { value: 'zh', flag: '🇨🇳', label: '中文' },
  { value: 'ja', flag: '🇯🇵', label: '日本語' },
  { value: 'en-gb', flag: '🇬🇧', label: 'English (UK)' },
]

const LOCALE_BY_VALUE = new Map(LOCALE_META.map((entry) => [entry.value, entry]))

export function localeMeta(value: string | undefined): LocaleMeta | undefined {
  return LOCALE_BY_VALUE.get(value as LocaleChoice)
}

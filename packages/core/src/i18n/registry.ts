export type TranslationParams = Record<string, string | number>

export type PluralMessage = {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

export type TranslationMessage = string | PluralMessage
export type TranslationMessages = Record<string, TranslationMessage>

const catalogs = new Map<string, Map<string, TranslationMessage>>()
const listeners = new Set<() => void>()
const warnedMissingKeys = new Set<string>()

let locale = 'en'
let version = 0

function canonicalLocale(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'en'
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? 'en'
  } catch {
    return 'en'
  }
}

function localeFallbacks(value: string): string[] {
  const exact = canonicalLocale(value)
  try {
    const parsed = new Intl.Locale(exact)
    const candidates = [exact]
    if (parsed.baseName !== exact) candidates.push(parsed.baseName)
    if (parsed.script) candidates.push(`${parsed.language}-${parsed.script}`)
    if (parsed.language === 'zh' && parsed.script === 'Hans') candidates.push('zh-CN')
    candidates.push(parsed.language)
    return [...new Set(candidates)]
  } catch {
    return [exact]
  }
}

function isDevelopment(): boolean {
  try {
    const meta = import.meta as { env?: { DEV?: boolean } }
    if (typeof meta.env?.DEV === 'boolean') return meta.env.DEV
  } catch {
    // Fall through for runtimes without import.meta.env.
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
}

function emitChange(): void {
  version += 1
  for (const listener of [...listeners]) listener()
}

export function registerMessages(
  messageLocale: string,
  namespace: string,
  messages: TranslationMessages,
): void {
  const normalizedLocale = canonicalLocale(messageLocale)
  const normalizedNamespace = namespace.replace(/^\.+|\.+$/g, '')
  const catalog = catalogs.get(normalizedLocale) ?? new Map<string, TranslationMessage>()

  for (const [key, message] of Object.entries(messages)) {
    const normalizedKey = key.replace(/^\.+/g, '')
    const fullKey = normalizedNamespace ? `${normalizedNamespace}.${normalizedKey}` : normalizedKey
    catalog.set(fullKey, message)
  }

  catalogs.set(normalizedLocale, catalog)
  emitChange()
}

export function setLocale(nextLocale: string): void {
  const normalized = canonicalLocale(nextLocale)
  if (normalized === locale) return
  locale = normalized
  emitChange()
}

export function getLocale(): string {
  return locale
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getI18nVersion(): number {
  return version
}

function messageFor(key: string, requestedLocale: string): TranslationMessage | undefined {
  for (const candidate of localeFallbacks(requestedLocale)) {
    const message = catalogs.get(candidate)?.get(key)
    if (message !== undefined) return message
  }
  return undefined
}

function warnMissing(key: string, requestedLocale: string): void {
  if (!isDevelopment() || requestedLocale === 'en') return
  const warningId = `${requestedLocale}:${key}`
  if (warnedMissingKeys.has(warningId)) return
  warnedMissingKeys.add(warningId)
  console.warn(`[i18n] Missing "${key}" for locale "${requestedLocale}"; using English.`)
}

function selectPlural(
  message: TranslationMessage,
  count: number | undefined,
  requestedLocale: string,
): string {
  if (typeof message === 'string') return message
  if (count === undefined) return message.other

  let category: Intl.LDMLPluralRule = 'other'
  try {
    category = new Intl.PluralRules(requestedLocale).select(count)
  } catch {
    category = new Intl.PluralRules('en').select(count)
  }

  const translated = message[category] ?? message.other
  return translated
}

function interpolate(message: string, params: TranslationParams | undefined): string {
  if (!params) return message
  return message.replace(/\{([A-Za-z_][\w.-]*)\}/g, (placeholder, name: string) => {
    const value = params[name]
    return value === undefined ? placeholder : String(value)
  })
}

export function translate(
  key: string,
  englishDefault: TranslationMessage,
  params?: TranslationParams,
  requestedLocale = locale,
): string {
  const normalizedLocale = canonicalLocale(requestedLocale)
  const translated = normalizedLocale === 'en' ? undefined : messageFor(key, normalizedLocale)
  if (translated === undefined) warnMissing(key, normalizedLocale)
  const message = translated ?? englishDefault
  const count = typeof params?.count === 'number' ? params.count : undefined
  const pluralLocale = translated === undefined ? 'en' : normalizedLocale
  return interpolate(selectPlural(message, count, pluralLocale), params)
}

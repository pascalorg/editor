import {
  type I18n as LinguiI18n,
  type MessageDescriptor,
  type MessageOptions,
  type Messages,
  setupI18n,
  type Values,
} from '@lingui/core'

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export type TranslationParams = Record<string, string | number>
/** @experimental Unreleased API; signatures may change before the first i18n release. */
export type TranslationMessage = string
/** @experimental Unreleased API; signatures may change before the first i18n release. */
export type TranslationMessages = Record<string, TranslationMessage>
/** @experimental Unreleased API; signatures may change before the first i18n release. */
export type CompiledTranslationMessages = Messages

const catalogs = new Map<string, Messages>()
const scopes = new Set<PascalI18n>()
const warnedMissingKeys = new Set<string>()

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

function namespacedMessages(namespace: string, messages: Messages): Messages {
  const normalizedNamespace = namespace.replace(/^\.+|\.+$/g, '')
  return Object.fromEntries(
    Object.entries(messages).map(([key, message]) => {
      const normalizedKey = key.replace(/^\.+/g, '')
      return [
        normalizedNamespace ? `${normalizedNamespace}.${normalizedKey}` : normalizedKey,
        message,
      ]
    }),
  )
}

function mergedMessages(requestedLocale: string): Messages {
  const messages: Messages = {}
  for (const candidate of localeFallbacks(requestedLocale).reverse()) {
    Object.assign(messages, catalogs.get(candidate))
  }
  return messages
}

function warnMissing(key: string, requestedLocale: string): void {
  if (!isDevelopment() || requestedLocale === 'en') return
  const warningId = `${requestedLocale}:${key}`
  if (warnedMissingKeys.has(warningId)) return
  warnedMissingKeys.add(warningId)
  console.warn(`[i18n] Missing "${key}" for locale "${requestedLocale}"; using English.`)
}

/**
 * A request- or editor-local locale selection over Pascal's shared message
 * registry. Message parsing, interpolation, and ICU selection are delegated to
 * private Lingui instances.
 *
 * @experimental Unreleased API; signatures may change before the first i18n release.
 */
export class PascalI18n {
  readonly i18n: LinguiI18n
  private readonly englishI18n: LinguiI18n
  private readonly listeners = new Set<() => void>()
  private locale: string
  private version = 0

  constructor(initialLocale = 'en') {
    this.locale = canonicalLocale(initialLocale)
    this.i18n = setupI18n()
    this.englishI18n = setupI18n()
    scopes.add(this)
    this.refresh(false)
  }

  getLocale(): string {
    return this.locale
  }

  getVersion(): number {
    return this.version
  }

  setLocale(nextLocale: string): void {
    const normalized = canonicalLocale(nextLocale)
    if (normalized === this.locale) return
    this.locale = normalized
    this.refresh()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy(): void {
    scopes.delete(this)
    this.listeners.clear()
  }

  _(descriptor: MessageDescriptor): string
  _(id: string, values?: Values, options?: MessageOptions): string
  _(idOrDescriptor: string | MessageDescriptor, values?: Values, options?: MessageOptions): string {
    const id = typeof idOrDescriptor === 'string' ? idOrDescriptor : idOrDescriptor.id
    const translated =
      this.locale === 'en' || Object.prototype.hasOwnProperty.call(this.i18n.messages, id)
    const runtime = translated ? this.i18n : this.englishI18n
    if (!translated) warnMissing(id, this.locale)
    return typeof idOrDescriptor === 'string'
      ? runtime._(idOrDescriptor, values, options)
      : runtime._(idOrDescriptor)
  }

  refresh(notify = true): void {
    this.i18n.loadAndActivate({
      locale: this.locale,
      messages: mergedMessages(this.locale),
    })
    this.englishI18n.loadAndActivate({
      locale: 'en',
      messages: mergedMessages('en'),
    })
    if (!notify) return
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Create an isolated locale scope backed by the shared Pascal message packs.
 *
 * @experimental Unreleased API; signatures may change before the first i18n release.
 */
export function createI18n(options: { locale?: string } = {}): PascalI18n {
  return new PascalI18n(options.locale)
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export const defaultI18n = createI18n()

/**
 * Register a raw ICU MessageFormat pack. The Lingui compiler is loaded only
 * for this authoring/host path; bundled packs use registerCompiledMessages.
 * The whole pack is validated before it becomes visible.
 *
 * @experimental Unreleased API; signatures may change before the first i18n release.
 */
export async function registerMessages(
  messageLocale: string,
  namespace: string,
  messages: TranslationMessages,
): Promise<void> {
  const { compileMessageOrThrow } = await import('@lingui/message-utils/compileMessage')
  const compiled = Object.fromEntries(
    Object.entries(messages).map(([key, message]) => [key, compileMessageOrThrow(message)]),
  )
  registerCompiledMessages(messageLocale, namespace, compiled)
}

/**
 * Register a catalog produced by `lingui compile`. Later registrations replace
 * earlier messages with the same fully namespaced ID.
 *
 * @experimental Unreleased API; signatures may change before the first i18n release.
 */
export function registerCompiledMessages(
  messageLocale: string,
  namespace: string,
  messages: CompiledTranslationMessages,
): void {
  const normalizedLocale = canonicalLocale(messageLocale)
  const catalog = catalogs.get(normalizedLocale) ?? {}
  Object.assign(catalog, namespacedMessages(namespace, messages))
  catalogs.set(normalizedLocale, catalog)
  for (const scope of [...scopes]) scope.refresh()
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function setLocale(nextLocale: string): void {
  defaultI18n.setLocale(nextLocale)
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function getLocale(): string {
  return defaultI18n.getLocale()
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function subscribe(listener: () => void): () => void {
  return defaultI18n.subscribe(listener)
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function getI18nVersion(): number {
  return defaultI18n.getVersion()
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function translate(
  key: string,
  englishDefault: TranslationMessage,
  params?: TranslationParams,
  requestedLocale = getLocale(),
): string {
  const scope =
    canonicalLocale(requestedLocale) === defaultI18n.getLocale()
      ? defaultI18n
      : createI18n({ locale: requestedLocale })
  try {
    return scope._({ id: key, message: englishDefault, values: params })
  } finally {
    if (scope !== defaultI18n) scope.destroy()
  }
}

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export type Message =
  | string
  | {
      zero?: string
      one?: string
      two?: string
      few?: string
      many?: string
      other: string
    }

export type SourceEntry = {
  default: Message
  hash: string
  context: string[]
}

export type SourceCatalog = Record<string, SourceEntry>

export type LocaleEntry = {
  message: Message
  sourceHash: string
}

export type LocaleCatalog = {
  locale: string
  messages: Record<string, LocaleEntry>
}

export type TranslationRequest = {
  locale: string
  items: Array<{ key: string; source: Message; context: string[] }>
  glossary: Record<string, unknown>
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<Record<string, Message>>
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_CATALOG_PATH = join(ROOT, 'packages/editor/src/i18n/source-catalog.json')
const LOCALE_CATALOG_DIR = join(ROOT, 'packages/editor/src/i18n/catalogs')
const GLOSSARY_PATH = join(ROOT, 'i18n/glossary.json')
const BUNDLED_LOCALES = ['zh-CN', 'fr', 'es', 'ja'] as const
const SOURCE_GLOBS = [
  'packages/core/src/**/*.{ts,tsx}',
  'packages/viewer/src/**/*.{ts,tsx}',
  'packages/editor/src/**/*.{ts,tsx}',
  'packages/nodes/src/**/*.{ts,tsx}',
  'apps/editor/**/*.{ts,tsx}',
]
const CONVERTED_SURFACES = [
  'packages/editor/src/components/viewer',
  'packages/editor/src/components/ui/build-panel/build-panel.tsx',
]
const PLURAL_KEYS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

function hashMessage(message: Message): string {
  return createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0, 16)
}

function messageFromNode(node: ts.Expression): Message | null {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (!ts.isObjectLiteralExpression(node)) return null

  const message: Partial<Record<(typeof PLURAL_KEYS)[number], string>> = {}
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null
    const name =
      ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        ? property.name.text
        : null
    if (!(name && PLURAL_KEYS.includes(name as (typeof PLURAL_KEYS)[number]))) return null
    if (!ts.isStringLiteralLike(property.initializer)) return null
    message[name as (typeof PLURAL_KEYS)[number]] = property.initializer.text
  }
  return typeof message.other === 'string' ? (message as Message) : null
}

function sourceFiles(): string[] {
  const files = new Set<string>()
  for (const pattern of SOURCE_GLOBS) {
    const glob = new Bun.Glob(pattern)
    for (const path of glob.scanSync({ cwd: ROOT, absolute: true, onlyFiles: true })) {
      if (
        path.includes('/node_modules/') ||
        /\.test\.[tj]sx?$/.test(path) ||
        path.includes('/__fixtures__/')
      ) {
        continue
      }
      files.add(path)
    }
  }
  return [...files].sort()
}

export function extractSourceCatalog(root = ROOT): SourceCatalog {
  const found = new Map<string, { default: Message; context: Set<string> }>()

  for (const path of sourceFiles()) {
    const sourceText = readFileSync(path, 'utf8')
    const source = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 't' &&
        node.arguments.length >= 2
      ) {
        const keyNode = node.arguments[0]
        const defaultNode = node.arguments[1]
        if (!(keyNode && defaultNode && ts.isStringLiteralLike(keyNode))) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
          throw new Error(
            `${relative(root, path)}:${line}: t() keys and English defaults must be static literals`,
          )
        }
        const message = messageFromNode(defaultNode)
        if (message === null) {
          const line = source.getLineAndCharacterOfPosition(defaultNode.getStart()).line + 1
          throw new Error(
            `${relative(root, path)}:${line}: unsupported English message in t("${keyNode.text}")`,
          )
        }
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
        const context = `${relative(root, path)}:${line}`
        const existing = found.get(keyNode.text)
        if (existing && JSON.stringify(existing.default) !== JSON.stringify(message)) {
          throw new Error(`Conflicting English defaults for "${keyNode.text}"`)
        }
        if (existing) existing.context.add(context)
        else found.set(keyNode.text, { default: message, context: new Set([context]) })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return Object.fromEntries(
    [...found.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [
        key,
        {
          default: entry.default,
          hash: hashMessage(entry.default),
          context: [...entry.context].sort(),
        },
      ]),
  )
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  const formatted = Bun.spawnSync(
    [process.execPath, 'x', 'biome', 'format', '--write', relative(ROOT, path)],
    { cwd: ROOT, stdout: 'ignore', stderr: 'inherit' },
  )
  if (formatted.exitCode !== 0) throw new Error(`Could not format ${relative(ROOT, path)}`)
}

function localeCatalogPath(locale: string): string {
  return join(LOCALE_CATALOG_DIR, `${locale}.json`)
}

function messageStrings(message: Message): string[] {
  return typeof message === 'string' ? [message] : Object.values(message).filter(Boolean)
}

function placeholders(message: Message): string[] {
  const names = new Set<string>()
  for (const value of messageStrings(message)) {
    for (const match of value.matchAll(/\{([A-Za-z_][\w.-]*)\}/g)) names.add(match[1]!)
  }
  return [...names].sort()
}

function samePlaceholders(source: Message, translated: Message): boolean {
  if (typeof source === 'string' || typeof translated === 'string') {
    return (
      typeof source === 'string' &&
      typeof translated === 'string' &&
      JSON.stringify(placeholders(source)) === JSON.stringify(placeholders(translated))
    )
  }

  return Object.entries(translated).every(([category, value]) => {
    const sourceValue = source[category as keyof typeof source] ?? source.other
    return JSON.stringify(placeholders(sourceValue)) === JSON.stringify(placeholders(value))
  })
}

function isMessage(value: unknown): value is Message {
  if (typeof value === 'string') return true
  if (!(value && typeof value === 'object' && !Array.isArray(value))) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.other === 'string' &&
    Object.entries(record).every(
      ([key, entry]) =>
        PLURAL_KEYS.includes(key as (typeof PLURAL_KEYS)[number]) && typeof entry === 'string',
    )
  )
}

function currentSourceMatches(expected: SourceCatalog, actual: SourceCatalog): string[] {
  const errors: string[] = []
  for (const [key, entry] of Object.entries(actual)) {
    const stored = expected[key]
    if (!stored) errors.push(`source catalog is missing "${key}"`)
    else if (
      stored.hash !== entry.hash ||
      JSON.stringify(stored.default) !== JSON.stringify(entry.default)
    ) {
      errors.push(`source catalog is stale for "${key}"`)
    }
  }
  for (const key of Object.keys(expected)) {
    if (!actual[key]) errors.push(`source catalog has removed key "${key}"`)
  }
  return errors
}

function bypassedLiterals(): string[] {
  const warnings: string[] = []
  const paths = sourceFiles().filter((path) =>
    CONVERTED_SURFACES.some((surface) => {
      const absolute = join(ROOT, surface)
      return path === absolute || path.startsWith(`${absolute}/`)
    }),
  )

  for (const path of paths) {
    const sourceText = readFileSync(path, 'utf8')
    const source = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    function warning(node: ts.Node, text: string): void {
      if (!/[A-Za-z]{2}/.test(text)) return
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      warnings.push(`${relative(ROOT, path)}:${line}: "${text.trim()}"`)
    }
    function visit(node: ts.Node): void {
      if (ts.isJsxText(node)) warning(node, node.text)
      if (
        ts.isJsxAttribute(node) &&
        ['aria-label', 'title', 'placeholder', 'label', 'alt'].includes(node.name.text) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      ) {
        warning(node, node.initializer.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return warnings
}

export function checkCatalogs(root = ROOT): string[] {
  const errors: string[] = []
  const actual = extractSourceCatalog(root)
  const stored = readJson<SourceCatalog>(SOURCE_CATALOG_PATH)
  errors.push(...currentSourceMatches(stored, actual))

  for (const locale of BUNDLED_LOCALES) {
    const catalog = readJson<LocaleCatalog>(localeCatalogPath(locale))
    for (const [key, source] of Object.entries(actual)) {
      const translation = catalog.messages[key]
      if (!translation) {
        errors.push(`${locale}: missing "${key}"`)
        continue
      }
      if (translation.sourceHash !== source.hash) errors.push(`${locale}: stale "${key}"`)
      if (!samePlaceholders(source.default, translation.message)) {
        errors.push(`${locale}: broken placeholders in "${key}"`)
      }
      if (
        typeof source.default === 'object' &&
        (typeof translation.message !== 'object' ||
          !Object.keys(source.default).every((category) => category in translation.message))
      ) {
        errors.push(`${locale}: missing plural forms in "${key}"`)
      }
    }
  }
  return errors
}

function promptFor(request: TranslationRequest): string {
  return [
    `Translate these Pascal architecture/CAD interface messages into ${request.locale}.`,
    'Return one JSON object mapping every input key to its translated string or plural-form object.',
    'Preserve {placeholders} exactly. Keep labels concise and use a consistent professional CAD glossary.',
    'Do not add commentary or markdown. Human reviewers will approve the resulting diff.',
    `Glossary: ${JSON.stringify(request.glossary)}`,
    `Messages: ${JSON.stringify(request.items)}`,
  ].join('\n\n')
}

function parseProviderResponse(text: string, request: TranslationRequest): Record<string, Message> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Translation provider did not return JSON')
  const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const messages: Record<string, Message> = {}
  for (const item of request.items) {
    const message = parsed[item.key]
    if (!isMessage(message)) throw new Error(`Translation provider omitted "${item.key}"`)
    if (!samePlaceholders(item.source, message)) {
      throw new Error(`Translation provider changed placeholders in "${item.key}"`)
    }
    messages[item.key] = message
  }
  return messages
}

function configuredProvider(): TranslationProvider {
  const provider =
    process.env.I18N_PROVIDER ??
    (process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : '')
  const model = process.env.I18N_MODEL
  if (!model) throw new Error('Set I18N_MODEL to the translation model')

  if (provider === 'openai') {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('Set OPENAI_API_KEY for the OpenAI translation provider')
    return {
      async translate(request) {
        const response = await fetch(
          `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model,
              response_format: { type: 'json_object' },
              messages: [{ role: 'user', content: promptFor(request) }],
            }),
          },
        )
        if (!response.ok) throw new Error(`OpenAI translation failed (${response.status})`)
        const body = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        return parseProviderResponse(body.choices?.[0]?.message?.content ?? '', request)
      },
    }
  }

  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('Set ANTHROPIC_API_KEY for the Anthropic translation provider')
    return {
      async translate(request) {
        const response = await fetch(
          `${process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
              'x-api-key': key,
            },
            body: JSON.stringify({
              model,
              max_tokens: 8192,
              messages: [{ role: 'user', content: promptFor(request) }],
            }),
          },
        )
        if (!response.ok) throw new Error(`Anthropic translation failed (${response.status})`)
        const body = (await response.json()) as {
          content?: Array<{ type?: string; text?: string }>
        }
        const text = body.content?.find((block) => block.type === 'text')?.text ?? ''
        return parseProviderResponse(text, request)
      },
    }
  }

  throw new Error('Set I18N_PROVIDER to "openai" or "anthropic" and provide its API key')
}

export async function refreshLocaleCatalog(
  source: SourceCatalog,
  catalog: LocaleCatalog,
  provider: TranslationProvider,
  glossary: Record<string, unknown>,
): Promise<LocaleCatalog> {
  const stale = Object.entries(source)
    .filter(([key, entry]) => catalog.messages[key]?.sourceHash !== entry.hash)
    .map(([key, entry]) => ({ key, source: entry.default, context: entry.context }))
  if (stale.length === 0) return catalog

  const messages = { ...catalog.messages }
  for (let offset = 0; offset < stale.length; offset += 40) {
    const items = stale.slice(offset, offset + 40)
    const translated = await provider.translate({ locale: catalog.locale, items, glossary })
    for (const item of items) {
      const message = translated[item.key]
      if (!message) throw new Error(`Translation provider omitted "${item.key}"`)
      if (!isMessage(message))
        throw new Error(`Translation provider returned an invalid message for "${item.key}"`)
      if (!samePlaceholders(item.source, message)) {
        throw new Error(`Translation provider changed placeholders in "${item.key}"`)
      }
      messages[item.key] = { message, sourceHash: source[item.key]!.hash }
    }
  }
  return { ...catalog, messages: Object.fromEntries(Object.entries(messages).sort()) }
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'extract') {
    const catalog = extractSourceCatalog()
    writeJson(SOURCE_CATALOG_PATH, catalog)
    console.log(
      `Extracted ${Object.keys(catalog).length} messages to ${relative(ROOT, SOURCE_CATALOG_PATH)}`,
    )
    return
  }

  if (command === 'check') {
    const errors = checkCatalogs()
    for (const literal of bypassedLiterals()) {
      console.warn(`[i18n warning] user-facing literal bypasses t(): ${literal}`)
    }
    if (errors.length > 0) {
      console.error(errors.map((error) => `[i18n] ${error}`).join('\n'))
      process.exitCode = 1
    } else {
      console.log(`Checked ${BUNDLED_LOCALES.length} bundled locale catalogs`)
    }
    return
  }

  if (command === 'translate') {
    const requested = process.argv.slice(3)
    const locales = requested.length > 0 ? requested : [...BUNDLED_LOCALES]
    const source = readJson<SourceCatalog>(SOURCE_CATALOG_PATH)
    const glossary = readJson<Record<string, unknown>>(GLOSSARY_PATH)
    const provider = configuredProvider()
    for (const locale of locales) {
      if (!BUNDLED_LOCALES.includes(locale as (typeof BUNDLED_LOCALES)[number])) {
        throw new Error(`Unknown bundled locale "${locale}"`)
      }
      const path = localeCatalogPath(locale)
      const catalog = readJson<LocaleCatalog>(path)
      const refreshed = await refreshLocaleCatalog(source, catalog, provider, glossary)
      writeJson(path, refreshed)
      console.log(`Updated ${relative(ROOT, path)}`)
    }
    return
  }

  throw new Error('Usage: bun scripts/i18n.ts <extract|check|translate> [locale...]')
}

if (import.meta.main) await main()

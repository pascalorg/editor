import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCompiledCatalog, getCatalogs } from '@lingui/cli/api'
import { getConfig } from '@lingui/conf'
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage'
import { type PoFile, type PoItem, parsePo, stringifyPo } from 'pofile-ts'
import ts from 'typescript'

export type SourceMessage = {
  id: string
  message: string
  context: string[]
}

export type TranslationEntry = {
  translation: string
  sourceHash?: string
  review: 'human' | 'required' | 'missing'
  fuzzy: boolean
  reviewNotes?: string
}

export type TranslationRequest = {
  locale: string
  items: SourceMessage[]
  glossary: Glossary
}

export type TranslationResponse = {
  locale: string
  entries: Array<{ id: string; translation: string; reviewNotes: string }>
}

export interface TranslationProvider {
  name: string
  model: string
  translate(request: TranslationRequest): Promise<TranslationResponse>
}

type Glossary = {
  productContext?: string
  terms?: Record<string, Record<string, string | undefined>>
}

type CompiledToken = string | [name: string, type?: string, choices?: unknown]

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_ROOT = join(ROOT, 'packages/editor/src/i18n/locales')
const GLOSSARY_PATH = join(ROOT, 'i18n/glossary.json')
const LINGUI_BIN = join(ROOT, 'node_modules/.bin/lingui')
const TARGET_LOCALES = ['zh-CN', 'fr', 'es', 'ja'] as const
const ALL_LOCALES = ['en', ...TARGET_LOCALES] as const
const CONVERTED_SURFACES = [
  'packages/editor/src/components/viewer',
  'packages/editor/src/components/ui/build-panel/build-panel.tsx',
]
const SOURCE_GLOBS = [
  'packages/core/src/**/*.{ts,tsx}',
  'packages/viewer/src/**/*.{ts,tsx}',
  'packages/editor/src/**/*.{ts,tsx}',
  'packages/nodes/src/**/*.{ts,tsx}',
  'apps/editor/**/*.{ts,tsx}',
]
const SOURCE_HASH_PREFIX = 'Source-Hash: '
const REVIEW_PREFIX = 'Review: '
const ENGLISH_PREFIX = 'English: '
const AI_PROVIDER_PREFIX = 'AI-Provider: '
const AI_MODEL_PREFIX = 'AI-Model: '
const REVIEW_NOTES_PREFIX = 'Review-Notes: '

function catalogPath(locale: string): string {
  return join(CATALOG_ROOT, locale, 'messages.po')
}

function compiledCatalogPath(locale: string): string {
  return join(CATALOG_ROOT, locale, 'messages.ts')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function hashSource(message: string): string {
  return createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0, 16)
}

export function escapePoCommentValue(value: string): string {
  return value.replaceAll('\r\n', '\\n').replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}

function commentValue(item: PoItem, prefix: string): string | undefined {
  return item.comments.find((comment) => comment.startsWith(prefix))?.slice(prefix.length)
}

function replaceComment(item: PoItem, prefix: string, value?: string): void {
  item.comments = item.comments.filter((comment) => !comment.startsWith(prefix))
  if (value !== undefined) item.comments.push(`${prefix}${value}`)
}

function sourceMessagesFromPo(po: PoFile): SourceMessage[] {
  return po.items
    .filter((item) => !item.obsolete)
    .map((item) => ({
      id: item.msgid,
      message: item.msgstr[0] ?? '',
      context: [...item.references],
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function readSourceMessages(): SourceMessage[] {
  return sourceMessagesFromPo(parsePo(readFileSync(catalogPath('en'), 'utf8')))
}

async function extractSourceMessages(): Promise<SourceMessage[]> {
  const config = getConfig({ cwd: ROOT })
  const catalogs = await getCatalogs(config)
  const collected = await Promise.all(catalogs.map((catalog) => catalog.collect()))
  const messages = new Map<string, SourceMessage>()

  for (const catalog of collected) {
    for (const [id, entry] of Object.entries(catalog ?? {})) {
      const message = entry.message ?? ''
      const existing = messages.get(id)
      if (existing && existing.message !== message) {
        throw new Error(`Lingui extracted conflicting English sources for "${id}"`)
      }
      messages.set(id, {
        id,
        message,
        context: entry.origin.map(([path, line]) => (line ? `${path}:${line}` : path)),
      })
    }
  }

  return [...messages.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function readTranslationState(po: PoFile): Record<string, TranslationEntry> {
  return Object.fromEntries(
    po.items
      .filter((item) => !item.obsolete)
      .map((item) => {
        const review = commentValue(item, REVIEW_PREFIX)
        return [
          item.msgid,
          {
            translation: item.msgstr[0] ?? '',
            sourceHash: commentValue(item, SOURCE_HASH_PREFIX),
            review: review === 'human' || review === 'required' ? review : 'missing',
            fuzzy: Boolean(item.flags.fuzzy),
            reviewNotes: commentValue(item, REVIEW_NOTES_PREFIX),
          } satisfies TranslationEntry,
        ]
      }),
  )
}

function variableNames(tokens: CompiledToken[]): string[] {
  const names = new Set<string>()
  const visit = (entries: CompiledToken[]) => {
    for (const token of entries) {
      if (typeof token === 'string') continue
      names.add(token[0])
      const choices = token[2]
      if (!(choices && typeof choices === 'object')) continue
      for (const branch of Object.values(choices)) {
        if (Array.isArray(branch)) visit(branch as CompiledToken[])
      }
    }
  }
  visit(tokens)
  return [...names].sort()
}

function tags(message: string): string[] {
  const found: string[] = []
  for (let start = message.indexOf('<'); start >= 0; start = message.indexOf('<', start + 1)) {
    let quote: '"' | "'" | undefined
    let end = start + 1
    for (; end < message.length; end += 1) {
      const character = message[end]
      if (quote) {
        if (character === quote) quote = undefined
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
    }
    if (end >= message.length) continue
    const token = message.slice(start, end + 1)
    if (/^<\s*\/?\s*[A-Za-z][\w-]*(?:\s|\/?>)/.test(token)) found.push(token)
  }
  return found.sort()
}

function plurals(tokens: CompiledToken[]): Map<string, { type: string; categories: Set<string> }> {
  const found = new Map<string, { type: string; categories: Set<string> }>()
  const visit = (entries: CompiledToken[]) => {
    for (const token of entries) {
      if (typeof token === 'string') continue
      const type = token[1]
      const choices = token[2]
      if (
        (type === 'plural' || type === 'selectordinal') &&
        choices &&
        typeof choices === 'object'
      ) {
        found.set(token[0], {
          type,
          categories: new Set(Object.keys(choices).filter((category) => category !== 'offset')),
        })
      }
      if (!(choices && typeof choices === 'object')) continue
      for (const branch of Object.values(choices)) {
        if (Array.isArray(branch)) visit(branch as CompiledToken[])
      }
    }
  }
  visit(tokens)
  return found
}

function requiredPluralCategories(locale: string, type: string): Intl.LDMLPluralRule[] {
  return new Intl.PluralRules(locale, {
    type: type === 'selectordinal' ? 'ordinal' : 'cardinal',
  }).resolvedOptions().pluralCategories
}

function validateGlossary(
  source: string,
  translation: string,
  locale: string,
  glossary: Glossary,
): string[] {
  const errors: string[] = []
  const normalizedSource = source
    .replaceAll(/\{[^}]+\}/g, '')
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .toLocaleLowerCase('en')
  const normalizedTranslation = translation.toLocaleLowerCase(locale)
  for (const [english, localized] of Object.entries(glossary.terms ?? {})) {
    const expected = localized[locale]
    const normalizedTerm = english.toLocaleLowerCase('en')
    if (
      typeof expected === 'string' &&
      normalizedSource === normalizedTerm &&
      !normalizedTranslation.includes(expected.toLocaleLowerCase(locale))
    ) {
      errors.push(`expected glossary term "${expected}" for "${english}"`)
    }
  }
  return errors
}

export function validateTranslation(
  source: string,
  translation: string,
  locale: string,
  glossary: Glossary = {},
): string[] {
  const errors: string[] = []
  let sourceTokens: CompiledToken[]
  let translatedTokens: CompiledToken[]
  try {
    sourceTokens = compileMessageOrThrow(source) as CompiledToken[]
  } catch (error) {
    return [`invalid English ICU: ${error instanceof Error ? error.message : String(error)}`]
  }
  try {
    translatedTokens = compileMessageOrThrow(translation) as CompiledToken[]
  } catch (error) {
    return [`invalid translated ICU: ${error instanceof Error ? error.message : String(error)}`]
  }

  if (
    JSON.stringify(variableNames(sourceTokens)) !== JSON.stringify(variableNames(translatedTokens))
  ) {
    errors.push('placeholder names differ from English')
  }
  if (JSON.stringify(tags(source)) !== JSON.stringify(tags(translation))) {
    errors.push('rich-text tags differ from English')
  }

  const sourcePlurals = plurals(sourceTokens)
  const translatedPlurals = plurals(translatedTokens)
  for (const [name, sourcePlural] of sourcePlurals) {
    const translatedPlural = translatedPlurals.get(name)
    if (!translatedPlural || translatedPlural.type !== sourcePlural.type) {
      errors.push(`plural selector "${name}" is missing or changed`)
      continue
    }
    for (const category of requiredPluralCategories(locale, sourcePlural.type)) {
      if (!translatedPlural.categories.has(category)) {
        errors.push(`plural selector "${name}" is missing "${category}"`)
      }
    }
  }
  errors.push(...validateGlossary(source, translation, locale, glossary))
  return errors
}

function assertProviderResponse(
  request: TranslationRequest,
  response: TranslationResponse,
  currentBatch: SourceMessage[],
): Map<string, { translation: string; reviewNotes: string }> {
  if (response.locale !== request.locale) {
    throw new Error(
      `Translation provider returned locale "${response.locale}" for "${request.locale}"`,
    )
  }
  const expectedIds = currentBatch.map((item) => item.id).sort()
  const actualIds = response.entries.map((entry) => entry.id).sort()
  if (
    new Set(actualIds).size !== actualIds.length ||
    JSON.stringify(actualIds) !== JSON.stringify(expectedIds)
  ) {
    throw new Error('Translation provider returned missing, duplicate, or unexpected message IDs')
  }

  const byId = new Map(response.entries.map((entry) => [entry.id, entry]))
  for (const source of currentBatch) {
    const result = byId.get(source.id)
    if (!result) throw new Error(`Translation provider omitted "${source.id}"`)
    const errors = validateTranslation(
      source.message,
      result.translation,
      request.locale,
      request.glossary,
    )
    if (errors.length > 0) {
      throw new Error(`Translation provider returned invalid "${source.id}": ${errors.join('; ')}`)
    }
  }
  return byId
}

export async function refreshTranslations(
  locale: string,
  sources: SourceMessage[],
  current: Record<string, TranslationEntry>,
  provider: TranslationProvider,
  glossary: Glossary = {},
): Promise<Record<string, TranslationEntry>> {
  const stale = sources.filter((source) => {
    const existing = current[source.id]
    return !existing?.translation || existing.sourceHash !== hashSource(source.message)
  })
  if (stale.length === 0) return current

  const updated = { ...current }
  for (let offset = 0; offset < stale.length; offset += 40) {
    const items = stale.slice(offset, offset + 40)
    const request = { locale, items, glossary }
    const response = await provider.translate(request)
    const translated = assertProviderResponse(request, response, items)
    for (const source of items) {
      const result = translated.get(source.id)!
      updated[source.id] = {
        translation: result.translation,
        sourceHash: hashSource(source.message),
        review: 'required',
        fuzzy: true,
        reviewNotes: result.reviewNotes,
      }
    }
  }
  return updated
}

function promptFor(request: TranslationRequest): string {
  return [
    `Translate these Pascal architecture/CAD interface messages into ${request.locale}.`,
    'Return every input ID exactly once. Preserve ICU placeholders and rich-text tags exactly.',
    `For ICU plurals, include the categories used by ${request.locale}: ${requiredPluralCategories(request.locale, 'plural').join(', ')}.`,
    'Use natural, concise professional UI language. Do not translate IDs.',
    'reviewNotes should briefly flag ambiguity or be an empty string.',
    `Product and glossary: ${JSON.stringify(request.glossary)}`,
    `Messages: ${JSON.stringify(request.items)}`,
  ].join('\n\n')
}

async function configuredProvider(): Promise<TranslationProvider> {
  const name =
    process.env.I18N_PROVIDER ??
    (process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : '')
  const modelName = process.env.I18N_MODEL
  if (!modelName) throw new Error('Set I18N_MODEL to the translation model')

  if (name === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('Set OPENAI_API_KEY for the OpenAI translation provider')
  }
  if (name === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('Set ANTHROPIC_API_KEY for the Anthropic translation provider')
  }
  if (name !== 'openai' && name !== 'anthropic') {
    throw new Error('Set I18N_PROVIDER to "openai" or "anthropic" and provide its API key')
  }

  const [{ generateText, Output }, { z }] = await Promise.all([import('ai'), import('zod')])
  const model =
    name === 'openai'
      ? (await import('@ai-sdk/openai')).createOpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL,
        })(modelName)
      : (await import('@ai-sdk/anthropic')).createAnthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          baseURL: process.env.ANTHROPIC_BASE_URL,
        })(modelName)
  const translationOutputSchema = z.object({
    locale: z.string(),
    entries: z.array(
      z.object({
        id: z.string(),
        translation: z.string(),
        reviewNotes: z.string(),
      }),
    ),
  })

  return {
    name,
    model: modelName,
    async translate(request) {
      const result = await generateText({
        model,
        output: Output.object({ schema: translationOutputSchema }),
        prompt: promptFor(request),
      })
      return result.output
    },
  }
}

function runLinguiExtract(locales: readonly string[], overwrite = false): void {
  const args = [LINGUI_BIN, 'extract', '--clean', '--locale', locales.join(','), '--workers', '1']
  if (overwrite) args.push('--overwrite')
  const result = Bun.spawnSync(args, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) throw new Error('Lingui extract failed')
}

function checkLinguiCatalogSync(): string[] {
  const result = Bun.spawnSync([LINGUI_BIN, 'check', 'sync', '--clean', '--workers', '1'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return result.exitCode === 0 ? [] : ['PO catalogs are not synchronized; run bun run i18n:extract']
}

function writePo(path: string, po: PoFile): void {
  writeFileSync(path, stringifyPo(po, { foldLength: 0 }))
}

function annotateCatalogs(
  previous: Map<(typeof TARGET_LOCALES)[number], Record<string, TranslationEntry>>,
): void {
  const sources = readSourceMessages()
  const byId = new Map(sources.map((source) => [source.id, source]))
  for (const locale of TARGET_LOCALES) {
    const path = catalogPath(locale)
    const po = parsePo(readFileSync(path, 'utf8'))
    for (const item of po.items) {
      if (item.obsolete) continue
      const source = byId.get(item.msgid)
      if (!source) continue
      replaceComment(item, ENGLISH_PREFIX, JSON.stringify(source.message))
      const sourceHash = hashSource(source.message)
      const prior = previous.get(locale)?.[item.msgid]
      if (!item.msgstr[0]) {
        replaceComment(item, SOURCE_HASH_PREFIX)
        replaceComment(item, REVIEW_PREFIX, 'missing')
        delete item.flags.fuzzy
      } else if (prior?.sourceHash && prior.sourceHash !== sourceHash) {
        replaceComment(item, SOURCE_HASH_PREFIX, prior.sourceHash)
        replaceComment(item, REVIEW_PREFIX, 'required')
        item.flags.fuzzy = true
      } else if (!prior?.sourceHash) {
        replaceComment(item, SOURCE_HASH_PREFIX, sourceHash)
        replaceComment(item, REVIEW_PREFIX, 'human')
        delete item.flags.fuzzy
      }
    }
    writePo(path, po)
  }
}

function messagesForCompilation(locale: string, sources: SourceMessage[]): Record<string, string> {
  const sourceHashes = new Map(sources.map((source) => [source.id, hashSource(source.message)]))
  const po = parsePo(readFileSync(catalogPath(locale), 'utf8'))
  return Object.fromEntries(
    po.items
      .filter((item) => {
        if (item.obsolete || !item.msgstr[0]) return false
        if (locale === 'en') return true
        return (
          !item.flags.fuzzy &&
          commentValue(item, REVIEW_PREFIX) === 'human' &&
          commentValue(item, SOURCE_HASH_PREFIX) === sourceHashes.get(item.msgid)
        )
      })
      .map((item) => [item.msgid, item.msgstr[0] ?? '']),
  )
}

function compiledCatalog(locale: string, sources: SourceMessage[]) {
  return createCompiledCatalog(locale, messagesForCompilation(locale, sources), {
    namespace: 'ts',
    outputPrefix: '/*eslint-disable*/',
    strict: true,
  })
}

function writeCompiledCatalogs(strict = false): void {
  const sources = readSourceMessages()
  if (strict) {
    const errors = checkCatalogMessages(sources, readJson<Glossary>(GLOSSARY_PATH))
    if (errors.length > 0) throw new Error(errors.join('\n'))
  }
  const compiled = ALL_LOCALES.map((locale) => [locale, compiledCatalog(locale, sources)] as const)
  const errors = compiled.flatMap(([locale, result]) =>
    result.errors.map(({ id, error }) => `${locale}: failed to compile "${id}": ${error.message}`),
  )
  if (errors.length > 0) throw new Error(errors.join('\n'))
  for (const [locale, result] of compiled) {
    writeFileSync(compiledCatalogPath(locale), result.source)
  }
}

export function extractCatalogs(): void {
  const previous = new Map(
    TARGET_LOCALES.map((locale) => [
      locale,
      readTranslationState(parsePo(readFileSync(catalogPath(locale), 'utf8'))),
    ]),
  )
  runLinguiExtract(['en'], true)
  runLinguiExtract(TARGET_LOCALES)
  annotateCatalogs(previous)
  writeCompiledCatalogs()
}

function applyTranslations(
  po: PoFile,
  sources: SourceMessage[],
  entries: Record<string, TranslationEntry>,
  provider: TranslationProvider,
): void {
  const byId = new Map(sources.map((source) => [source.id, source]))
  for (const item of po.items) {
    const source = byId.get(item.msgid)
    const entry = entries[item.msgid]
    if (!(source && entry)) continue
    item.msgstr = [entry.translation]
    replaceComment(item, ENGLISH_PREFIX, JSON.stringify(source.message))
    replaceComment(item, SOURCE_HASH_PREFIX, entry.sourceHash)
    replaceComment(item, REVIEW_PREFIX, entry.review)
    replaceComment(
      item,
      REVIEW_NOTES_PREFIX,
      entry.reviewNotes ? escapePoCommentValue(entry.reviewNotes) : undefined,
    )
    replaceComment(
      item,
      AI_PROVIDER_PREFIX,
      entry.review === 'required' ? provider.name : undefined,
    )
    replaceComment(item, AI_MODEL_PREFIX, entry.review === 'required' ? provider.model : undefined)
    if (entry.fuzzy) item.flags.fuzzy = true
    else delete item.flags.fuzzy
  }
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

function bypassedLiterals(): string[] {
  const warnings: string[] = []
  const paths = sourceFiles().filter((path) =>
    CONVERTED_SURFACES.some((surface) => {
      const absolute = join(ROOT, surface)
      return path === absolute || path.startsWith(`${absolute}/`)
    }),
  )

  for (const path of paths) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const warning = (node: ts.Node, text: string) => {
      if (!/[A-Za-z]{2}/.test(text)) return
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      warnings.push(`${relative(ROOT, path)}:${line}: "${text.trim()}"`)
    }
    const visit = (node: ts.Node): void => {
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

function checkCatalogMessages(sources: SourceMessage[], glossary: Glossary): string[] {
  const errors: string[] = []
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  for (const source of sources) {
    if (!source.message) errors.push(`en: missing source for "${source.id}"`)
  }

  for (const locale of TARGET_LOCALES) {
    const po = parsePo(readFileSync(catalogPath(locale), 'utf8'))
    const entries = readTranslationState(po)
    for (const source of sources) {
      const entry = entries[source.id]
      if (!entry?.translation) {
        errors.push(`${locale}: missing "${source.id}"`)
        continue
      }
      if (entry.sourceHash !== hashSource(source.message)) {
        errors.push(`${locale}: stale "${source.id}"`)
      }
      if (entry.fuzzy || entry.review !== 'human') {
        errors.push(`${locale}: "${source.id}" still requires human review`)
      }
      for (const error of validateTranslation(
        source.message,
        entry.translation,
        locale,
        glossary,
      )) {
        errors.push(`${locale}: invalid "${source.id}": ${error}`)
      }
    }
    for (const id of Object.keys(entries)) {
      if (!sourceById.has(id)) errors.push(`${locale}: obsolete "${id}"`)
    }
  }
  return errors
}

function checkEnglishCatalog(
  extractedSources: SourceMessage[],
  catalogSources: SourceMessage[],
): string[] {
  const errors: string[] = []
  const extracted = new Map(extractedSources.map((source) => [source.id, source]))
  const catalog = new Map(catalogSources.map((source) => [source.id, source]))
  for (const source of extractedSources) {
    const catalogSource = catalog.get(source.id)
    if (!catalogSource) {
      errors.push(`en: source catalog is missing "${source.id}"`)
    } else if (catalogSource.message !== source.message) {
      errors.push(
        `en: source drift "${source.id}" (code: ${JSON.stringify(source.message)}, catalog: ${JSON.stringify(catalogSource.message)})`,
      )
    }
  }
  for (const source of catalogSources) {
    if (!extracted.has(source.id)) errors.push(`en: obsolete "${source.id}"`)
  }
  return errors
}

function checkCompiledCatalogs(sources: SourceMessage[]): string[] {
  return ALL_LOCALES.flatMap((locale) => {
    const compiled = compiledCatalog(locale, sources)
    const errors = compiled.errors.map(
      ({ id, error }) => `${locale}: failed to compile "${id}": ${error.message}`,
    )
    if (compiled.source !== readFileSync(compiledCatalogPath(locale), 'utf8')) {
      errors.push(
        `${relative(ROOT, compiledCatalogPath(locale))} is not synchronized; run bun run i18n:compile`,
      )
    }
    return errors
  })
}

export async function checkCatalogs(): Promise<string[]> {
  const sources = await extractSourceMessages()
  const catalogSources = readSourceMessages()
  const glossary = readJson<Glossary>(GLOSSARY_PATH)
  return [
    ...checkLinguiCatalogSync(),
    ...checkEnglishCatalog(sources, catalogSources),
    ...checkCatalogMessages(sources, glossary),
    ...checkCompiledCatalogs(catalogSources),
  ]
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'extract') {
    extractCatalogs()
    console.log(`Extracted and compiled ${readSourceMessages().length} Lingui messages`)
    return
  }

  if (command === 'compile') {
    writeCompiledCatalogs(true)
    console.log(`Compiled ${ALL_LOCALES.length} Lingui catalogs`)
    return
  }

  if (command === 'check') {
    const errors = await checkCatalogs()
    for (const literal of bypassedLiterals()) {
      console.warn(`[i18n warning] user-facing literal bypasses Lingui: ${literal}`)
    }
    if (errors.length > 0) {
      console.error(errors.map((error) => `[i18n] ${error}`).join('\n'))
      process.exitCode = 1
    } else {
      console.log(`Checked ${TARGET_LOCALES.length} complete bundled PO catalogs`)
    }
    return
  }

  if (command === 'translate') {
    extractCatalogs()
    const requested = process.argv.slice(3)
    const locales = requested.length > 0 ? requested : [...TARGET_LOCALES]
    const sources = readSourceMessages()
    const glossary = readJson<Glossary>(GLOSSARY_PATH)
    const provider = await configuredProvider()
    for (const locale of locales) {
      if (!TARGET_LOCALES.includes(locale as (typeof TARGET_LOCALES)[number])) {
        throw new Error(`Unknown bundled locale "${locale}"`)
      }
      const path = catalogPath(locale)
      const po = parsePo(readFileSync(path, 'utf8'))
      const refreshed = await refreshTranslations(
        locale,
        sources,
        readTranslationState(po),
        provider,
        glossary,
      )
      applyTranslations(po, sources, refreshed, provider)
      writePo(path, po)
      console.log(`Updated ${relative(ROOT, path)}; AI entries are fuzzy and require human review`)
    }
    return
  }

  throw new Error('Usage: bun scripts/i18n.ts <extract|compile|check|translate> [locale...]')
}

if (import.meta.main) await main()

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCompiledCatalog, getCatalogs } from '@lingui/cli/api'
import { getConfig } from '@lingui/conf'
import { compileMessageOrThrow } from '@lingui/message-utils/compileMessage'
import { type PoFile, type PoItem, parsePo, stringifyPo } from 'pofile-ts'
import {
  baseRevision,
  firstCommitWith,
  headRevision,
  lastReleaseTag,
  readAtRevision,
  resolveRevision,
} from './i18n-git'
import { checkRepositoryLiterals } from './i18n-literals'
import { checkDefinitionMessages, writeDefinitionMessages } from './i18n-node-messages'

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
  /** Declared with a `renamed-from: <old id>` descriptor comment (`#.` in the PO). */
  renamedFrom?: string
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

const ROOT = process.env.I18N_ROOT
  ? resolve(process.env.I18N_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_ROOT = process.env.I18N_CATALOG_ROOT
  ? resolve(process.env.I18N_CATALOG_ROOT)
  : join(ROOT, 'packages/editor/src/i18n/locales')
const GLOSSARY_PATH = join(ROOT, 'i18n/glossary.json')
const LINGUI_BIN = join(ROOT, 'node_modules/.bin/lingui')
const TARGET_LOCALES = ['zh-CN', 'fr', 'es', 'ja'] as const
const ALL_LOCALES = ['en', ...TARGET_LOCALES] as const
/** Generated from English for layout and coverage testing; never shipped as a language. */
export const PSEUDO_LOCALE = 'en-XA'
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

const RENAMED_FROM_PREFIX = 'renamed-from:'

function renamedFrom(item: PoItem): string | undefined {
  const comment = item.extractedComments.find((value) => value.startsWith(RENAMED_FROM_PREFIX))
  return comment?.slice(RENAMED_FROM_PREFIX.length).trim() || undefined
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
            renamedFrom: renamedFrom(item),
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

/**
 * Review state extraction writes for one target entry, or undefined to keep
 * it. A newly filled translation is a draft unless a person already marked it
 * `Review: human` without `fuzzy`; extraction never approves copy itself.
 */
export function annotatedState(
  prior: TranslationEntry | undefined,
  translation: string,
  sourceHash: string,
): Pick<TranslationEntry, 'sourceHash' | 'review' | 'fuzzy'> | undefined {
  if (!translation) return { sourceHash: undefined, review: 'missing', fuzzy: false }
  if (prior?.sourceHash && prior.sourceHash !== sourceHash) {
    return { sourceHash: prior.sourceHash, review: 'required', fuzzy: true }
  }
  if (prior?.sourceHash) return undefined
  return prior?.review === 'human' && !prior.fuzzy
    ? { sourceHash, review: 'human', fuzzy: false }
    : { sourceHash, review: 'required', fuzzy: true }
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
      const declared = renamedFrom(item)
      const origin = declared ? previous.get(locale)?.[declared] : undefined
      if (
        !item.msgstr[0] &&
        origin?.translation &&
        origin.review === 'human' &&
        !origin.fuzzy &&
        origin.sourceHash === sourceHash
      ) {
        // A declared rename with unchanged English keeps its reviewed translation.
        item.msgstr = [origin.translation]
        replaceComment(item, SOURCE_HASH_PREFIX, sourceHash)
        replaceComment(item, REVIEW_PREFIX, 'human')
        delete item.flags.fuzzy
        continue
      }
      const state = annotatedState(prior, item.msgstr[0] ?? '', sourceHash)
      if (state) {
        replaceComment(item, SOURCE_HASH_PREFIX, state.sourceHash)
        replaceComment(item, REVIEW_PREFIX, state.review)
        if (state.fuzzy) item.flags.fuzzy = true
        else delete item.flags.fuzzy
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
    const errors = checkTranslationEntries(
      sources,
      readLocaleEntries((path) => readFileSync(path, 'utf8')),
      readJson<Glossary>(GLOSSARY_PATH),
      {},
    )
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
  writePseudoCatalog(sources)
}

const PSEUDO_LETTERS: Record<string, string> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, index) => [
    letter,
    [...'áƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'][index]!,
  ]),
)

/**
 * en-XA: every letter accented and the text padded by about 30 %, wrapped in
 * brackets so clipping shows. ICU arguments, plural/select keys, `#`, quoted
 * literals and rich-text tags are copied unchanged.
 */
export function pseudoLocalize(message: string): string {
  let index = 0
  let letters = 0

  const text = (end: (character: string) => boolean, inPlural: boolean): string => {
    let out = ''
    while (index < message.length) {
      const character = message[index]!
      if (end(character)) return out
      if (character === "'") {
        const next = message[index + 1]
        if (next === "'") {
          out += "''"
          index += 2
          continue
        }
        if (next === '{' || next === '}' || next === '#' || next === '<') {
          const close = message.indexOf("'", index + 1)
          const stop = close === -1 ? message.length : close + 1
          out += message.slice(index, stop)
          index = stop
          continue
        }
      }
      if (character === '{') {
        out += argument()
        continue
      }
      if (character === '<') {
        const close = message.indexOf('>', index)
        const stop = close === -1 ? message.length : close + 1
        out += message.slice(index, stop)
        index = stop
        continue
      }
      if (character === '#' && inPlural) {
        out += character
        index += 1
        continue
      }
      const mapped = PSEUDO_LETTERS[character]
      if (mapped) letters += 1
      out += mapped ?? character
      index += 1
    }
    return out
  }

  const argument = (): string => {
    const start = index
    index += 1
    const header = message.slice(index).match(/^\s*([^,}\s]+)\s*(?:,\s*(\w+)\s*)?/)
    const type = header?.[2]
    if (!(type === 'plural' || type === 'select' || type === 'selectordinal')) {
      let depth = 1
      while (index < message.length && depth > 0) {
        if (message[index] === '{') depth += 1
        if (message[index] === '}') depth -= 1
        index += 1
      }
      return message.slice(start, index)
    }
    index += header![0].length
    let out = message.slice(start, index)
    if (message[index] === ',') {
      out += ','
      index += 1
    }
    while (index < message.length && message[index] !== '}') {
      const open = message.indexOf('{', index)
      if (open === -1) break
      out += message.slice(index, open + 1)
      index = open + 1
      out += text((character) => character === '}', type !== 'select')
      out += '}'
      index += 1
      const spaces = message.slice(index).match(/^\s*/)?.[0] ?? ''
      if (message[index + spaces.length] === '}') {
        out += spaces
        index += spaces.length
      }
    }
    out += '}'
    index += 1
    return out
  }

  const body = text(() => false, false)
  if (letters === 0) return body
  return `[${body} ${'~'.repeat(Math.max(1, Math.ceil(letters * 0.3)))}]`
}

function pseudoCatalog(sources: SourceMessage[]) {
  const english = messagesForCompilation('en', sources)
  return createCompiledCatalog(
    PSEUDO_LOCALE,
    Object.fromEntries(
      Object.entries(english).map(([id, message]) => [id, pseudoLocalize(message)]),
    ),
    { namespace: 'ts', outputPrefix: '/*eslint-disable*/', strict: true },
  )
}

function writePseudoCatalog(sources: SourceMessage[]): void {
  const compiled = pseudoCatalog(sources)
  if (compiled.errors.length > 0) {
    throw new Error(
      compiled.errors
        .map(({ id, error }) => `${PSEUDO_LOCALE}: "${id}": ${error.message}`)
        .join('\n'),
    )
  }
  mkdirSync(dirname(compiledCatalogPath(PSEUDO_LOCALE)), { recursive: true })
  writeFileSync(compiledCatalogPath(PSEUDO_LOCALE), compiled.source)
}

function checkPseudoCatalog(sources: SourceMessage[]): string[] {
  const path = compiledCatalogPath(PSEUDO_LOCALE)
  const compiled = pseudoCatalog(sources)
  const errors = compiled.errors.map(
    ({ id, error }) => `${PSEUDO_LOCALE}: failed to compile "${id}": ${error.message}`,
  )
  if (!existsSync(path) || compiled.source !== readFileSync(path, 'utf8')) {
    errors.push(`${relative(ROOT, path)} is not synchronized; run bun run i18n:compile`)
  }
  return errors
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

export type CatalogCheckOptions = {
  /**
   * Release sign-off: every bundled entry must be human-reviewed. Ordinary CI
   * accepts AI drafts that are `fuzzy` + `Review: required`; they are kept out
   * of the compiled packs, so the UI shows English until a person approves.
   */
  requireReviewed?: boolean
}

export function pendingReview(sources: SourceMessage[]): Record<string, number> {
  return Object.fromEntries(
    TARGET_LOCALES.map((locale) => {
      const entries = readTranslationState(parsePo(readFileSync(catalogPath(locale), 'utf8')))
      const pending = sources.filter((source) => {
        const entry = entries[source.id]
        return entry && (entry.fuzzy || entry.review !== 'human')
      }).length
      return [locale, pending]
    }),
  )
}

export type LocaleEntries = Record<string, Record<string, TranslationEntry>>

function readLocaleEntries(read: (path: string) => string | undefined): LocaleEntries {
  const entries: LocaleEntries = {}
  for (const locale of TARGET_LOCALES) {
    const text = read(catalogPath(locale))
    if (text !== undefined) entries[locale] = readTranslationState(parsePo(text))
  }
  return entries
}

/** Pure completeness/validity/review rules for the bundled target catalogs. */
export function checkTranslationEntries(
  sources: SourceMessage[],
  entriesByLocale: LocaleEntries,
  glossary: Glossary,
  options: CatalogCheckOptions = { requireReviewed: true },
): string[] {
  const errors: string[] = []
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  for (const source of sources) {
    if (!source.message) errors.push(`en: missing source for "${source.id}"`)
  }

  for (const locale of TARGET_LOCALES) {
    const entries = entriesByLocale[locale] ?? {}
    for (const source of sources) {
      const entry = entries[source.id]
      if (!entry?.translation) {
        errors.push(`${locale}: missing "${source.id}"`)
        continue
      }
      const awaitingReview = entry.fuzzy || entry.review !== 'human'
      const stale = entry.sourceHash !== hashSource(source.message)
      if (stale && !(awaitingReview && !options.requireReviewed)) {
        errors.push(`${locale}: stale "${source.id}"`)
      }
      if (awaitingReview && options.requireReviewed) {
        errors.push(`${locale}: "${source.id}" still requires human review`)
      } else if (awaitingReview && !(entry.fuzzy && entry.review === 'required')) {
        errors.push(
          `${locale}: "${source.id}" is unreviewed but not marked fuzzy + Review: required`,
        )
      }
      // A stale draft translates the previous English; it is never shipped and
      // is compared with the current English when it is translated again.
      if (stale && awaitingReview) continue
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

/**
 * A translation a person approved on the base branch stays approved while its
 * English is unchanged: a PR may edit it (still `Review: human`) but never
 * send it back to draft, which would silently drop it from the shipped pack.
 */
export function reviewRegressions(
  sources: SourceMessage[],
  current: LocaleEntries,
  base: LocaleEntries,
): string[] {
  const errors: string[] = []
  for (const locale of TARGET_LOCALES) {
    for (const source of sources) {
      const before = base[locale]?.[source.id]
      if (
        !before?.translation ||
        before.fuzzy ||
        before.review !== 'human' ||
        before.sourceHash !== hashSource(source.message)
      ) {
        continue
      }
      const after = current[locale]?.[source.id]
      if (!after?.translation || after.fuzzy || after.review !== 'human') {
        errors.push(
          `${locale}: "${source.id}" is reviewed on the base branch with the same English and must stay reviewed`,
        )
      }
    }
    // A declared rename must arrive with the reviewed translation;
    // `i18n:extract` carries it over when the English is unchanged.
    const sourceIds = new Set(sources.map((source) => source.id))
    for (const source of sources) {
      const after = current[locale]?.[source.id]
      const removedId = after?.renamedFrom
      if (!removedId || sourceIds.has(removedId)) continue
      const before = base[locale]?.[removedId]
      if (
        !before?.translation ||
        before.fuzzy ||
        before.review !== 'human' ||
        before.sourceHash !== hashSource(source.message)
      ) {
        continue
      }
      const carried =
        after.translation === before.translation && after.review === 'human' && !after.fuzzy
      if (!carried) {
        errors.push(
          `${locale}: "${source.id}" is declared renamed-from "${removedId}", whose reviewed translation was not carried over; run bun run i18n:extract`,
        )
      }
    }
  }
  return errors
}

/**
 * Reviewed IDs removed while a new, undeclared ID has the same English. That
 * may be a rename or an unrelated addition; a missed carry-over only falls back
 * to English, so it is reported, not enforced.
 */
export function possibleRenames(
  sources: SourceMessage[],
  current: LocaleEntries,
  base: LocaleEntries,
): string[] {
  const sourceIds = new Set(sources.map((source) => source.id))
  const pairs = new Set<string>()
  for (const locale of TARGET_LOCALES) {
    const baseEntries = base[locale] ?? {}
    for (const [removedId, before] of Object.entries(baseEntries)) {
      if (sourceIds.has(removedId) || before.fuzzy || before.review !== 'human') continue
      for (const source of sources) {
        if (source.id in baseEntries || hashSource(source.message) !== before.sourceHash) continue
        const after = current[locale]?.[source.id]
        if (after?.renamedFrom || (after?.review === 'human' && !after.fuzzy)) continue
        pairs.add(`"${removedId}" → "${source.id}"`)
      }
    }
  }
  return [...pairs].map(
    (pair) =>
      `possible rename ${pair} (same English): carry over the translation if intended with comment: 'renamed-from: <old id>' and bun run i18n:extract`,
  )
}

function isApproved(entry: TranslationEntry | undefined, source: SourceMessage): boolean {
  return Boolean(
    entry?.translation &&
      !entry.fuzzy &&
      entry.review === 'human' &&
      entry.sourceHash === hashSource(source.message),
  )
}

/** The compiled module a browser loads for one locale, as message IDs. */
export function readCompiledPack(locale: string): Record<string, unknown> {
  const text = readFileSync(compiledCatalogPath(locale), 'utf8')
  const literal = text.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/)?.[1]
  if (!literal)
    throw new Error(`${relative(ROOT, compiledCatalogPath(locale))} has no compiled messages`)
  return JSON.parse(JSON.parse(literal) as string) as Record<string, unknown>
}

/**
 * Inspects the shipped packs themselves: a draft (fuzzy, `Review: required`,
 * unreviewed or stale) must never be compiled in, whatever produced the file.
 */
export function packLeaks(
  sources: SourceMessage[],
  current: LocaleEntries,
  packs: Record<string, Record<string, unknown>>,
): string[] {
  const byId = new Map(sources.map((source) => [source.id, source]))
  const errors: string[] = []
  for (const locale of TARGET_LOCALES) {
    for (const id of Object.keys(packs[locale] ?? {})) {
      const source = byId.get(id)
      if (!source || !isApproved(current[locale]?.[id], source)) {
        errors.push(`${locale}: compiled pack ships unreviewed "${id}"`)
      }
    }
  }
  return errors
}

export function draftCounts(
  sources: SourceMessage[],
  current: LocaleEntries,
): Record<string, number> {
  return Object.fromEntries(
    TARGET_LOCALES.map((locale) => [
      locale,
      sources.filter((source) => !isApproved(current[locale]?.[source.id], source)).length,
    ]),
  )
}

function writeJobSummary(
  sources: SourceMessage[],
  current: LocaleEntries,
  base?: string,
  warnings: string[] = [],
): void {
  const path = process.env.GITHUB_STEP_SUMMARY
  if (!path) return
  const counts = draftCounts(sources, current)
  const rows = TARGET_LOCALES.map((locale) => `| ${locale} | ${counts[locale]} |`)
  appendFileSync(
    path,
    [
      '### Translations awaiting review',
      '',
      `Drafts ship as English until reviewed. ${sources.length} messages${base ? `; compared with ${base}` : ''}.`,
      '',
      '| Locale | Drafts |',
      '| --- | --- |',
      ...rows,
      '',
      ...(warnings.length > 0
        ? ['**Warnings**', '', ...warnings.map((warning) => `- ${warning}`), '']
        : []),
    ].join('\n'),
  )
}

function currentEntries(): LocaleEntries {
  return readLocaleEntries((path) => readFileSync(path, 'utf8'))
}

function compiledPacks(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(TARGET_LOCALES.map((locale) => [locale, readCompiledPack(locale)]))
}

/** Regression and leak checks shared by `check` (CI) and `release-check` (release). */
export function releaseCheck(
  sources: SourceMessage[],
  base: LocaleEntries | undefined,
): { errors: string[]; warnings: string[] } {
  const current = currentEntries()
  return {
    errors: [
      ...(base ? reviewRegressions(sources, current, base) : []),
      ...packLeaks(sources, current, compiledPacks()),
    ],
    warnings: base ? possibleRenames(sources, current, base) : [],
  }
}

/** The package whose release carries the bundled catalogs. */
const CATALOG_PACKAGE = 'editor'

function hasCatalogs(revision: string): boolean {
  return TARGET_LOCALES.every(
    (locale) => readAtRevision(revision, catalogPath(locale)) !== undefined,
  )
}

/**
 * What a release is compared with: the latest `@pascal-app/editor@*` tag
 * whose tree has the catalogs; else `origin/main` when it is another commit
 * with catalogs; else the commit that introduced the catalogs, whose reviewed
 * entries must survive. Never the working tree, and never a base without
 * catalogs: with none available this throws.
 */
export function releaseBase(requested?: string): { revision: string; label: string } {
  const head = headRevision()
  if (requested) {
    const revision = resolveRevision(requested)
    if (!revision) throw new Error(`release-check: --base ${requested} is not a commit`)
    if (!hasCatalogs(revision)) {
      throw new Error(
        `release-check: --base ${requested} has no bundled PO catalogs to compare with`,
      )
    }
    return { revision, label: requested }
  }
  const tag = lastReleaseTag(CATALOG_PACKAGE)
  if (tag && hasCatalogs(tag.revision)) return { revision: tag.revision, label: tag.tag }
  const reason = tag ? `${tag.tag} has no catalogs` : 'no release tag'
  const main = resolveRevision('origin/main')
  if (main && main !== head && hasCatalogs(main)) {
    return { revision: main, label: `origin/main (${reason})` }
  }
  const introduced = firstCommitWith(catalogPath('fr'))
  if (introduced && introduced !== head && hasCatalogs(introduced)) {
    return {
      revision: introduced,
      label: `${introduced.slice(0, 12)}, the commit that introduced the catalogs (${reason})`,
    }
  }
  throw new Error(
    `release-check: no base with bundled PO catalogs (${reason}; origin/main and the catalogs' first commit are unavailable or HEAD); pass --base <rev>`,
  )
}

function checkCatalogMessages(
  sources: SourceMessage[],
  glossary: Glossary,
  options: CatalogCheckOptions = { requireReviewed: true },
): string[] {
  const current = currentEntries()
  const base = baseRevision()
  const release = releaseCheck(
    sources,
    base ? readLocaleEntries((path) => readAtRevision(base, path)) : undefined,
  )
  reportWarnings(release.warnings)
  writeJobSummary(sources, current, base?.slice(0, 12), release.warnings)
  return [...checkTranslationEntries(sources, current, glossary, options), ...release.errors]
}

function reportWarnings(warnings: string[]): void {
  for (const warning of warnings) console.warn(`[i18n warning] ${warning}`)
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

export async function checkCatalogs(options: CatalogCheckOptions = {}): Promise<string[]> {
  const sources = await extractSourceMessages()
  const catalogSources = readSourceMessages()
  const glossary = readJson<Glossary>(GLOSSARY_PATH)
  return [
    ...(await checkDefinitionMessages()),
    ...checkLinguiCatalogSync(),
    ...checkEnglishCatalog(sources, catalogSources),
    ...checkCatalogMessages(sources, glossary, options),
    ...checkCompiledCatalogs(catalogSources),
    ...checkPseudoCatalog(catalogSources),
  ]
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'extract') {
    await writeDefinitionMessages()
    extractCatalogs()
    console.log(`Extracted and compiled ${readSourceMessages().length} Lingui messages`)
    return
  }

  if (command === 'compile') {
    writeCompiledCatalogs(true)
    console.log(`Compiled ${ALL_LOCALES.length} Lingui catalogs`)
    return
  }

  if (command === 'release-check') {
    const flag = (name: string) => {
      const index = process.argv.indexOf(`--${name}`)
      return index === -1 ? undefined : process.argv[index + 1]
    }
    const baseDir = flag('base-dir')
    let resolved: { revision: string; label: string } | undefined
    try {
      resolved = baseDir ? undefined : releaseBase(flag('base'))
    } catch (error) {
      console.error(`[i18n] ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
      return
    }
    const revision = resolved?.revision
    if (resolved) console.log(`Comparing with ${resolved.label}`)
    const base = baseDir
      ? readLocaleEntries((path) => {
          const file = join(resolve(baseDir), relative(CATALOG_ROOT, path))
          return existsSync(file) ? readFileSync(file, 'utf8') : undefined
        })
      : readLocaleEntries((path) => readAtRevision(revision!, path))
    const sources = readSourceMessages()
    const { errors, warnings } = releaseCheck(sources, base)
    reportWarnings(warnings)
    writeJobSummary(sources, currentEntries(), resolved?.label ?? baseDir, warnings)
    if (errors.length > 0) {
      console.error(errors.map((error) => `[i18n] ${error}`).join('\n'))
      process.exitCode = 1
      return
    }
    console.log(
      `No reviewed translation regressed against ${baseDir ?? resolved?.label} and no draft is compiled in`,
    )
    return
  }

  if (command === 'check') {
    const requireReviewed = process.argv.includes('--reviewed')
    const errors = await checkCatalogs({ requireReviewed })
    const literals = checkRepositoryLiterals()
    errors.push(...literals.errors.map((error) => `literal guard: ${error}`))
    if (errors.length > 0) {
      console.error(errors.map((error) => `[i18n] ${error}`).join('\n'))
      process.exitCode = 1
      return
    }
    const pending = Object.entries(pendingReview(readSourceMessages()))
      .filter(([, count]) => count > 0)
      .map(([locale, count]) => `${locale} ${count}`)
    console.log(
      `Checked ${TARGET_LOCALES.length} bundled PO catalogs and ${literals.total} legacy literal candidates` +
        (pending.length > 0
          ? `; awaiting human review (shown in English until approved): ${pending.join(', ')}`
          : ''),
    )
    if (literals.improvable.length > 0) {
      console.log(
        `[i18n] ${literals.improvable.length} files are below their literal baseline; run bun run i18n:literals -- update`,
      )
    }
    return
  }

  if (command === 'translate') {
    await writeDefinitionMessages()
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

  throw new Error(
    'Usage: bun scripts/i18n.ts <extract|compile|check [--reviewed]|release-check [--base <rev>|--base-dir <dir>]|translate> [locale...]',
  )
}

if (import.meta.main) await main()

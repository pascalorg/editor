import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePo } from 'pofile-ts'
import ts from 'typescript'
import {
  enclosingComponent,
  normalizeJsxText,
  parseSource,
  placeholderName,
  type SentenceChild,
  scannedFiles,
  visitUiLiterals,
} from './i18n-literals'

/**
 * One-time migration: rewrites hardcoded UI copy into the runtime descriptor
 * form the packages already use, `i18n._({ id, message, values })`, and adds
 * `const i18n = usePascalI18n()` to the owning component. Dry run by default;
 * `--apply` writes. A second run over converted files changes nothing because
 * the scanner skips existing `i18n._(...)` calls.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EN_CATALOG = join(ROOT, 'packages/editor/src/i18n/locales/en/messages.po')
const ALLOWLIST_PATH = join(ROOT, 'i18n/literal-allowlist.json')
const HOOK = 'usePascalI18n'

type Edit = { start: number; end: number; text: string }

type Planned = {
  path: string
  line: number
  id?: string
  message: string
  manual?: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: '\u00a0',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
  times: '×',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Escapes ICU syntax characters that appear in literal copy. */
export function icuLiteral(text: string): string {
  return text.replace(/[{}]/g, (brace) => `'${brace}'`)
}

function camel(words: string[]): string {
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

function segmentName(segment: string): string {
  return camel(segment.split(/[-_.\s]+/).filter(Boolean))
}

/** `packages/editor/src/components/ui/sidebar/site-panel.tsx` → `editor.sidebar.sitePanel`. */
export function namespaceFor(path: string): string {
  const parts = path.replace(/\.[jt]sx?$/, '').split('/')
  let prefix: string[]
  let rest: string[]
  if (parts[0] === 'apps') {
    prefix = ['app']
    rest = parts.slice(2)
  } else if (parts[1] === 'nodes') {
    prefix = ['node', segmentName(parts[3] ?? 'shared')]
    rest = parts.slice(4)
  } else {
    prefix = [parts[1] ?? 'app']
    rest = parts.slice(3)
  }
  const segments = rest
    .filter((segment) => !['components', 'ui', 'app', 'src', 'index'].includes(segment))
    .map(segmentName)
  return [...prefix, ...segments]
    .filter((segment, index, all) => segment && segment !== all[index - 1])
    .join('.')
}

export function slugFor(message: string): string {
  const words = message
    .replace(/\{(\w+)[^}]*\}/g, ' $1 ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[A-Za-z0-9]+/g)
  if (!words?.length) {
    let hash = 0
    for (const character of message) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
    return `text${hash.toString(36).slice(0, 6)}`
  }
  const slug = camel(words.slice(0, 6))
  return /^[0-9]/.test(slug) ? `n${slug}` : slug
}

export class IdRegistry {
  private readonly messages = new Map<string, string>()

  constructor(existing: Record<string, string> = {}) {
    for (const [id, message] of Object.entries(existing)) this.messages.set(id, message)
  }

  idFor(path: string, message: string): string {
    const base = `${namespaceFor(path)}.${slugFor(message)}`
    for (let suffix = 1; ; suffix += 1) {
      const id = suffix === 1 ? base : `${base}${suffix}`
      const existing = this.messages.get(id)
      if (existing === undefined) {
        this.messages.set(id, message)
        return id
      }
      if (existing === message) return id
    }
  }
}

function existingMessages(): Record<string, string> {
  const po = parsePo(readFileSync(EN_CATALOG, 'utf8'))
  return Object.fromEntries(po.items.map((item) => [item.msgid, item.msgstr[0] ?? '']))
}

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function descriptor(id: string, message: string, values: Array<[string, string]>): string {
  const parts = [`id: ${quote(id)}`, `message: ${quote(message)}`]
  if (values.length > 0) {
    const entries = values.map(([name, expression]) =>
      name === expression ? name : `${name}: ${expression}`,
    )
    parts.push(`values: { ${entries.join(', ')} }`)
  }
  return `i18n._({ ${parts.join(', ')} })`
}

function uniqueValues(
  source: ts.SourceFile,
  items: Array<{ name: string; expression: ts.Expression }>,
) {
  const values: Array<[string, string]> = []
  const names = new Map<string, string>()
  const placeholders: string[] = []
  for (const item of items) {
    const expression = item.expression.getText(source)
    let name = item.name
    for (let suffix = 2; names.has(name) && names.get(name) !== expression; suffix += 1) {
      name = `${item.name}${suffix}`
    }
    if (!names.has(name)) {
      names.set(name, expression)
      values.push([name, expression])
    }
    placeholders.push(name)
  }
  return { placeholders, values }
}

function bindsI18n(component: ts.FunctionLikeDeclaration): boolean {
  const declaresI18n = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name)
      ? name.text === 'i18n'
      : name.elements.some(
          (element) => !ts.isOmittedExpression(element) && declaresI18n(element.name),
        )
  if (component.parameters.some((parameter) => declaresI18n(parameter.name))) return true
  const body = component.body
  if (!(body && ts.isBlock(body))) return false
  return body.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) => declaresI18n(declaration.name)),
  )
}

function hookEdits(source: ts.SourceFile, component: ts.FunctionLikeDeclaration): Edit[] {
  if (bindsI18n(component)) return []
  const body = component.body
  if (!body) return []
  if (ts.isBlock(body)) {
    const at = body.getStart(source) + 1
    return [{ start: at, end: at, text: `\n  const i18n = ${HOOK}()` }]
  }
  return [
    {
      start: body.getStart(source),
      end: body.getStart(source),
      text: `{\n  const i18n = ${HOOK}()\n  return (`,
    },
    { start: body.end, end: body.end, text: ')\n}' },
  ]
}

function importEdit(source: ts.SourceFile): Edit | undefined {
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@pascal-app/core'
    ) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        if (bindings.elements.some((element) => element.name.text === HOOK)) return undefined
        if (!statement.importClause?.isTypeOnly) {
          const last = bindings.elements[bindings.elements.length - 1]
          if (last) return { start: last.end, end: last.end, text: `, ${HOOK}` }
        }
      }
    }
  }
  const firstImport = source.statements.find(ts.isImportDeclaration)
  if (firstImport) {
    const at = firstImport.getStart(source)
    return { start: at, end: at, text: `import { ${HOOK} } from '@pascal-app/core'\n` }
  }
  const directive = source.statements.find(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text.startsWith('use '),
  )
  const at = directive ? directive.end : 0
  return {
    start: at,
    end: at,
    text: `${directive ? '\n\n' : ''}import { ${HOOK} } from '@pascal-app/core'\n`,
  }
}

function isServerOnly(path: string, source: ts.SourceFile): boolean {
  if (!path.startsWith('apps/editor/app/')) return false
  return !source.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === 'use client',
  )
}

function spacing(normalized: string): { lead: string; trail: string } {
  return {
    lead: /^\s/.test(normalized) ? "{' '}" : '',
    trail: /\s$/.test(normalized) ? "{' '}" : '',
  }
}

export type DescriptorTargets = {
  /** Object keys whose module-level string values become lazy descriptors. */
  keys?: ReadonlySet<string>
  /** Variables whose every string property value becomes a lazy descriptor. */
  variables?: ReadonlySet<string>
}

function declaredIn(node: ts.Node): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
  }
  return undefined
}

/**
 * Module data cannot call a hook, so its copy becomes `/* i18n *\/ { id, message }`,
 * which Lingui extracts and components render with `i18n._(descriptor)`. The
 * value's type changes to `MessageDescriptor`; the type checker then points at
 * every consumer to update.
 */
function descriptorEdits(
  source: ts.SourceFile,
  path: string,
  registry: IdRegistry,
  allow: Set<string>,
  targets: DescriptorTargets,
  planned: Planned[],
): Edit[] {
  const edits: Edit[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      !enclosingComponent(node)
    ) {
      const variable = declaredIn(node)
      const wanted =
        targets.keys?.has(node.name.text) ||
        (variable !== undefined && targets.variables?.has(variable))
      const value = node.initializer.text
      if (wanted && /\p{L}{2}/u.test(value) && !allow.has(value.trim())) {
        const message = icuLiteral(value)
        const id = registry.idFor(path, message)
        planned.push({
          path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          id,
          message,
        })
        edits.push({
          start: node.initializer.getStart(source),
          end: node.initializer.end,
          text: `/* i18n */ { id: ${quote(id)}, message: ${quote(message)} }`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edits
}

export function convertSource(
  path: string,
  text: string,
  registry: IdRegistry,
  allow: Set<string>,
  targets: DescriptorTargets = {},
): { output: string; planned: Planned[] } {
  const source = parseSource(path, text)
  const planned: Planned[] = []
  const edits: Edit[] = descriptorEdits(source, path, registry, allow, targets, planned)
  const described = new Set(edits.map((edit) => edit.start))
  const components = new Set<ts.FunctionLikeDeclaration>()
  const serverOnly = isServerOnly(path, source)

  const owner = (node: ts.Node, message: string): ts.FunctionLikeDeclaration | undefined => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const component = enclosingComponent(node)
    const manual = serverOnly
      ? 'server component: pass the request scope instead of a hook'
      : component
        ? undefined
        : 'outside a component or hook: needs a lazy descriptor or an i18n parameter'
    if (manual) {
      planned.push({ path, line, message, manual })
      return undefined
    }
    return component
  }

  const record = (node: ts.Node, message: string): string => {
    const id = registry.idFor(path, message)
    planned.push({
      path,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      id,
      message,
    })
    return id
  }

  visitUiLiterals(
    source,
    {
      jsxText(node, normalized) {
        const message = icuLiteral(decodeEntities(normalized.trim()))
        const component = owner(node, message)
        if (!component) return
        components.add(component)
        const { lead, trail } = spacing(normalized)
        const raw = node.text
        const before = raw.match(/^\s*/)?.[0] ?? ''
        const after = raw.match(/\s*$/)?.[0] ?? ''
        edits.push({
          start: node.pos,
          end: node.end,
          text: `${before.includes('\n') ? before : ''}${lead}{${descriptor(record(node, message), message, [])}}${trail}${after.includes('\n') ? after : ''}`,
        })
      },
      sentence(element, children: SentenceChild[]) {
        const values = uniqueValues(
          source,
          children.flatMap((child) => (child.type === 'value' ? [child] : [])),
        )
        let index = 0
        const raw = children
          .map((child) => {
            if (child.type === 'text') return icuLiteral(decodeEntities(child.text))
            const name = values.placeholders[index]
            index += 1
            return `\u0000${name}\u0001`
          })
          .join('')
        const normalized = normalizeJsxText(raw)
        const message = normalized.trim().replaceAll('\u0000', '{').replaceAll('\u0001', '}')
        const component = owner(element, message)
        if (!component) return
        components.add(component)
        const { lead, trail } = spacing(normalized)
        const first = children[0]!.node
        const last = children[children.length - 1]!.node
        edits.push({
          start: first.getStart(source),
          end: last.end,
          text: `${lead}{${descriptor(record(element, message), message, values.values)}}${trail}`,
        })
      },
      literal(node) {
        if (described.has(node.getStart(source))) return
        const message = icuLiteral(node.text)
        const component = owner(node, message)
        if (!component) return
        components.add(component)
        const call = descriptor(record(node, message), message, [])
        const directAttribute = ts.isJsxAttribute(node.parent)
        edits.push({
          start: node.getStart(source),
          end: node.end,
          text: directAttribute ? `{${call}}` : call,
        })
      },
      template(node) {
        const names = node.templateSpans.map((span) => placeholderName(span.expression))
        const preview = [
          node.head.text,
          ...node.templateSpans.map((span) => span.literal.text),
        ].join('{…}')
        if (names.includes(undefined)) {
          planned.push({
            path,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            message: preview,
            manual: 'complex template interpolation: name the values by hand',
          })
          return
        }
        const values = uniqueValues(
          source,
          node.templateSpans.map((span, spanIndex) => ({
            name: names[spanIndex]!,
            expression: span.expression,
          })),
        )
        const message = [
          icuLiteral(node.head.text),
          ...node.templateSpans.map(
            (span, spanIndex) =>
              `{${values.placeholders[spanIndex]}}${icuLiteral(span.literal.text)}`,
          ),
        ].join('')
        const component = owner(node, message)
        if (!component) return
        components.add(component)
        edits.push({
          start: node.getStart(source),
          end: node.end,
          text: descriptor(record(node, message), message, values.values),
        })
      },
    },
    allow,
  )

  if (edits.length === 0) return { output: text, planned }
  for (const component of components) edits.push(...hookEdits(source, component))
  const needsImport = [...components].some((component) => !bindsI18n(component))
  const importChange = needsImport ? importEdit(source) : undefined
  if (importChange) edits.push(importChange)

  let output = text
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  }
  return { output, planned }
}

export async function convertFiles(args: string[]): Promise<void> {
  const apply = args.includes('--apply')
  const list = (name: string) =>
    new Set(
      args
        .find((arg) => arg.startsWith(`--${name}=`))
        ?.slice(name.length + 3)
        .split(',')
        .filter(Boolean) ?? [],
    )
  const targets: DescriptorTargets = { keys: list('keys'), variables: list('vars') }
  const prefixes = args.filter((arg) => !arg.startsWith('--'))
  if (prefixes.length === 0) throw new Error('Pass the files or directories to convert')
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as { texts: string[] }
  const allow = new Set(allowlist.texts)
  const registry = new IdRegistry(existingMessages())
  const changed: string[] = []
  let converted = 0
  let manual = 0
  const explicit = prefixes.filter(
    (prefix) => /\.tsx?$/.test(prefix) && existsSync(join(ROOT, prefix)),
  )
  const files = new Set([
    ...explicit,
    ...scannedFiles().filter((path) =>
      prefixes.some((prefix) => path === prefix || path.startsWith(prefix.replace(/\/?$/, '/'))),
    ),
  ])
  for (const path of [...files].sort()) {
    const text = readFileSync(join(ROOT, path), 'utf8')
    const { output, planned } = convertSource(path, text, registry, allow, targets)
    for (const item of planned) {
      if (item.manual) manual += 1
      else converted += 1
      console.log(
        `${item.path}:${item.line}\t${item.id ?? 'MANUAL'}\t${JSON.stringify(item.message)}${item.manual ? `\t${item.manual}` : ''}`,
      )
    }
    if (output !== text) {
      changed.push(path)
      if (apply) writeFileSync(join(ROOT, path), output)
    }
  }
  console.log(
    `\n${converted} literals ${apply ? 'converted' : 'convertible'} in ${changed.length} files; ${manual} need manual work`,
  )
  if (apply && changed.length > 0) {
    Bun.spawnSync([join(ROOT, 'node_modules/.bin/biome'), 'check', '--write', ...changed], {
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
    })
  }
}

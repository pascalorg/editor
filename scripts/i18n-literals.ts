import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * User-visible literal scanner shared by the one-time codemod (`convert`) and
 * the CI ratchet (`check`). Both see exactly the same candidates, so a file
 * the codemod finished is a file the guard keeps finished.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'i18n/literal-baseline.json')
const ALLOWLIST_PATH = join(ROOT, 'i18n/literal-allowlist.json')

export const SCANNED_GLOBS = [
  'apps/editor/**/*.tsx',
  'packages/editor/src/**/*.tsx',
  'packages/viewer/src/**/*.tsx',
  'packages/nodes/src/**/*.tsx',
  'packages/core/src/**/*.tsx',
  'packages/ui/src/**/*.tsx',
  // Plain modules only contribute notification payloads (toast/alert/confirm).
  'apps/editor/**/*.ts',
  'packages/editor/src/**/*.ts',
]

const SKIPPED_PATH =
  /(?:\.test|\.spec|\.stories|\.bench|\.d)\.tsx?$|\/(?:__fixtures__|__tests__|__bench__|test-utils|node_modules|vendor)\//

/** JSX props whose string value is read by people or assistive technology. */
const UI_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'cancelLabel',
  'caption',
  'confirmLabel',
  'description',
  'emptyLabel',
  'emptyMessage',
  'emptyText',
  'heading',
  'helperText',
  'hint',
  'label',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
])

/** Object keys that carry display copy when built inside a component. */
const UI_PROPERTIES = new Set([
  'ariaLabel',
  'cancelLabel',
  'confirmLabel',
  'description',
  'detail',
  'emptyMessage',
  'heading',
  'hint',
  'label',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
])

const NOTIFY_CALLEES = new Set([
  'alert',
  'confirm',
  'prompt',
  'setError',
  'setErrorMessage',
  'setNotice',
  'setStatusMessage',
  'toast',
])
const NOTIFY_METHODS = new Set(['success', 'error', 'info', 'warning', 'message', 'loading'])

export type CandidateKind =
  | 'jsx-text'
  | 'jsx-sentence'
  | 'attribute'
  | 'expression'
  | 'property'
  | 'notify'

export type Candidate = {
  kind: CandidateKind
  /** English copy as rendered (JSX whitespace collapsed, placeholders as `{name}`). */
  text: string
  line: number
  /** Enclosing React component or hook that can own `usePascalI18n()`. */
  component?: string
  /** Why the codemod leaves this one for a person. */
  manual?: string
}

type Allowlist = {
  /** Exact strings that are not translatable copy anywhere (brands, units, symbols). */
  texts: string[]
  /** Path prefixes whose literals are not product UI, each with a reason. */
  paths: Record<string, string>
}

type Baseline = { version: 1; files: Record<string, number> }

function readAllowlist(): Allowlist {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as Allowlist
}

/** Mirrors React's JSX text whitespace rules (`jsx-runtime` collapses per line). */
export function normalizeJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/)
  if (lines.length === 1) return raw
  const parts: string[] = []
  lines.forEach((line, index) => {
    let value = line.replace(/\t/g, ' ')
    if (index > 0) value = value.replace(/^ +/, '')
    if (index < lines.length - 1) value = value.replace(/ +$/, '')
    if (value) parts.push(value)
  })
  return parts.join(' ')
}

function looksTranslatable(text: string, allow: Set<string>): boolean {
  const trimmed = text.trim()
  if (!/\p{L}{2}/u.test(trimmed)) return false
  if (allow.has(trimmed)) return false
  // Identifiers, icon names, CSS classes, paths and URLs.
  if (/^[a-z0-9]+(?:[-_:./#][a-z0-9]+)+$/i.test(trimmed) && !/\s/.test(trimmed)) return false
  if (/^(?:https?:|mailto:|\/|#|\.)/.test(trimmed)) return false
  if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed) && /[A-Z]/.test(trimmed)) return false
  return true
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function isIgnored(source: ts.SourceFile, node: ts.Node): boolean {
  const text = source.text
  const start = node.getStart(source)
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const previousLineStart = text.lastIndexOf('\n', lineStart - 2) + 1
  const window = text.slice(
    previousLineStart,
    text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start),
  )
  return window.includes('i18n-ignore')
}

function isTranslationCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === '_'
  )
}

function insideTranslationCall(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (isTranslationCall(current)) return true
  }
  return false
}

export function functionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name) return node.name.text
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    let parent = node.parent
    // memo(...) / forwardRef(...) wrappers
    while (parent && ts.isCallExpression(parent)) parent = parent.parent
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text
    }
  }
  return undefined
}

export function isComponentName(name: string | undefined): boolean {
  return Boolean(name && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)))
}

/** Outermost-first search for the component or hook that encloses `node`. */
export function enclosingComponent(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current)) &&
      isComponentName(functionName(current))
    ) {
      return current
    }
  }
  return undefined
}

function stringValue(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/** Placeholder name for a simple interpolated expression, or undefined when it needs a person. */
export function placeholderName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression) && !expression.questionDotToken) {
    return expression.name.text
  }
  if (ts.isNonNullExpression(expression)) return placeholderName(expression.expression)
  return undefined
}

export type SentenceChild =
  | { type: 'text'; node: ts.JsxText; text: string }
  | { type: 'value'; node: ts.JsxExpression; expression: ts.Expression; name: string }

/**
 * Children of an element that can become one ICU message: text plus simple
 * interpolations, no nested elements, at least one value.
 */
export function sentenceChildren(element: ts.JsxElement): SentenceChild[] | undefined {
  const children = element.children.filter(
    (child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
  )
  if (children.length < 2) return undefined
  const result: SentenceChild[] = []
  let hasText = false
  let hasValue = false
  for (const child of children) {
    if (ts.isJsxText(child)) {
      hasText ||= /\p{L}{2}/u.test(child.text)
      result.push({ type: 'text', node: child, text: child.text })
      continue
    }
    if (ts.isJsxExpression(child) && child.expression && !child.dotDotDotToken) {
      const name = placeholderName(child.expression)
      if (!name) return undefined
      hasValue = true
      result.push({ type: 'value', node: child, expression: child.expression, name })
      continue
    }
    return undefined
  }
  return hasText && hasValue ? result : undefined
}

export function sentenceMessage(children: SentenceChild[]): string {
  const raw = children
    .map((child) => (child.type === 'text' ? child.text : `\u0000${child.name}\u0001`))
    .join('')
  return normalizeJsxText(raw).trim().replaceAll('\u0000', '{').replaceAll('\u0001', '}')
}

function notifyCallee(node: ts.CallExpression): string | undefined {
  const callee = node.expression
  if (ts.isIdentifier(callee) && NOTIFY_CALLEES.has(callee.text)) return callee.text
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'toast' &&
    NOTIFY_METHODS.has(callee.name.text)
  ) {
    return `toast.${callee.name.text}`
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'window' &&
    NOTIFY_CALLEES.has(callee.name.text)
  ) {
    return `window.${callee.name.text}`
  }
  return undefined
}

export type Visitor = {
  jsxText(node: ts.JsxText, text: string): void
  sentence(element: ts.JsxElement, children: SentenceChild[], text: string): void
  literal(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, kind: CandidateKind): void
  template(node: ts.TemplateExpression, kind: CandidateKind): void
}

/** Walks every user-visible literal in one file. */
export function visitUiLiterals(source: ts.SourceFile, visitor: Visitor, allow: Set<string>): void {
  const notifyOnly = !source.fileName.endsWith('.tsx')
  const literalSink = (expression: ts.Expression | undefined, kind: CandidateKind): void => {
    if (!expression || (notifyOnly && kind !== 'notify')) return
    if (ts.isParenthesizedExpression(expression)) {
      literalSink(expression.expression, kind)
      return
    }
    if (ts.isConditionalExpression(expression)) {
      literalSink(expression.whenTrue, kind)
      literalSink(expression.whenFalse, kind)
      return
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      if (expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
        literalSink(expression.left, kind)
      }
      literalSink(expression.right, kind)
      return
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      if (looksTranslatable(expression.text, allow) && !isIgnored(source, expression)) {
        visitor.literal(expression, kind)
      }
      return
    }
    if (ts.isTemplateExpression(expression)) {
      const text = [
        expression.head.text,
        ...expression.templateSpans.map((span) => span.literal.text),
      ].join(' ')
      if (looksTranslatable(text, allow) && !isIgnored(source, expression)) {
        visitor.template(expression, kind)
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (isTranslationCall(node)) return

    if (ts.isJsxElement(node)) {
      const sentence = sentenceChildren(node)
      if (sentence) {
        const text = sentenceMessage(sentence)
        if (!isIgnored(source, sentence[0]!.node)) visitor.sentence(node, sentence, text)
        ts.forEachChild(node.openingElement, visit)
        return
      }
    }

    if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
      const text = normalizeJsxText(node.text)
      if (looksTranslatable(text, allow) && !isIgnored(source, node)) visitor.jsxText(node, text)
      return
    }

    if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      literalSink(node.expression, 'expression')
    }

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      UI_ATTRIBUTES.has(node.name.text)
    ) {
      const initializer = node.initializer
      if (initializer && ts.isStringLiteral(initializer)) literalSink(initializer, 'attribute')
      else if (initializer && ts.isJsxExpression(initializer)) {
        literalSink(initializer.expression, 'attribute')
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      UI_PROPERTIES.has(node.name.text) &&
      !insideTranslationCall(node)
    ) {
      literalSink(node.initializer, 'property')
    }

    if (ts.isCallExpression(node) && notifyCallee(node)) {
      literalSink(node.arguments[0], 'notify')
      const options = node.arguments[1]
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'description'
          ) {
            literalSink(property.initializer, 'notify')
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
}

export function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

export function scanSource(
  path: string,
  text: string,
  allowlist: Allowlist = readAllowlist(),
): Candidate[] {
  const source = parseSource(path, text)
  const allow = new Set(allowlist.texts)
  const candidates: Candidate[] = []
  const add = (node: ts.Node, kind: CandidateKind, value: string, manual?: string) => {
    const component = enclosingComponent(node)
    candidates.push({
      kind,
      text: value,
      line: lineOf(source, node),
      component: component ? functionName(component) : undefined,
      manual: manual ?? (component ? undefined : 'outside a component or hook'),
    })
  }
  visitUiLiterals(
    source,
    {
      jsxText: (node, value) => add(node, 'jsx-text', value.trim()),
      sentence: (element, _children, value) => add(element, 'jsx-sentence', value),
      literal: (node, kind) => add(node, kind, node.text),
      template: (node, kind) => {
        const names = node.templateSpans.map((span) => placeholderName(span.expression))
        const value = [
          node.head.text,
          ...node.templateSpans.map(
            (span, index) => `{${names[index] ?? '?'}}${span.literal.text}`,
          ),
        ].join('')
        add(
          node,
          kind,
          value,
          names.includes(undefined) ? 'complex template interpolation' : undefined,
        )
      },
    },
    allow,
  )
  return candidates
}

export function scannedFiles(): string[] {
  const allowlist = readAllowlist()
  const files = new Set<string>()
  for (const pattern of SCANNED_GLOBS) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: ROOT, onlyFiles: true })) {
      if (SKIPPED_PATH.test(`/${path}`)) continue
      if (Object.keys(allowlist.paths).some((prefix) => path.startsWith(prefix))) continue
      files.add(path)
    }
  }
  return [...files].sort()
}

export function scanRepository(): Map<string, Candidate[]> {
  const allowlist = readAllowlist()
  const result = new Map<string, Candidate[]>()
  for (const path of scannedFiles()) {
    const candidates = scanSource(path, readFileSync(join(ROOT, path), 'utf8'), allowlist)
    if (candidates.length > 0) result.set(path, candidates)
  }
  return result
}

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
}

function writeBaseline(scan: Map<string, Candidate[]>): void {
  const files = Object.fromEntries(
    [...scan.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, list]) => [path, list.length]),
  )
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ version: 1, files } satisfies Baseline, null, 2)}\n`,
  )
}

/**
 * The ratchet: a file may never gain hardcoded copy. Files absent from the
 * baseline (every new file) must have none.
 */
export function checkLiterals(
  scan = scanRepository(),
  baseline = readBaseline(),
): {
  errors: string[]
  improvable: string[]
  total: number
} {
  const errors: string[] = []
  const improvable: string[] = []
  let total = 0
  for (const [path, candidates] of scan) {
    total += candidates.length
    const allowed = baseline.files[path] ?? 0
    if (candidates.length > allowed) {
      const listed = candidates.map(
        (candidate) => `    ${path}:${candidate.line} ${JSON.stringify(candidate.text)}`,
      )
      errors.push(
        `${path}: ${candidates.length} untranslated user-visible literals (baseline ${allowed}). Wrap new copy with i18n._({ id, message }) or add an "i18n-ignore: <reason>" comment.\n${listed.join('\n')}`,
      )
    }
  }
  for (const [path, allowed] of Object.entries(baseline.files)) {
    const current = scan.get(path)?.length ?? 0
    if (current < allowed) improvable.push(`${path}: ${current} < ${allowed}`)
  }
  return { errors, improvable, total }
}

function report(scan: Map<string, Candidate[]>): void {
  const byArea = new Map<string, number>()
  for (const [path, candidates] of scan) {
    const area = path
      .split('/')
      .slice(0, path.startsWith('packages/editor/src/components/ui/') ? 6 : 4)
      .join('/')
    byArea.set(area, (byArea.get(area) ?? 0) + candidates.length)
  }
  for (const [area, count] of [...byArea.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(6)}  ${area}`)
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'check') {
    const { errors, improvable, total } = checkLiterals()
    if (improvable.length > 0) {
      console.log(
        `[i18n literals] ${improvable.length} files are below their baseline; run bun run i18n:literals -- update to lock in the progress`,
      )
    }
    if (errors.length > 0) {
      console.error(errors.map((error) => `[i18n literals] ${error}`).join('\n'))
      process.exitCode = 1
      return
    }
    console.log(`[i18n literals] no new untranslated literals (${total} legacy candidates remain)`)
    return
  }
  if (command === 'update') {
    writeBaseline(scanRepository())
    console.log(`Updated ${relative(ROOT, BASELINE_PATH)}`)
    return
  }
  if (command === 'report') {
    const scan = scanRepository()
    const filter = args.filter((arg) => !arg.startsWith('--'))
    if (args.includes('--files')) {
      for (const [path, candidates] of scan) {
        if (filter.length && !filter.some((prefix) => path.startsWith(prefix))) continue
        for (const candidate of candidates) {
          console.log(
            `${path}:${candidate.line}\t${candidate.kind}\t${candidate.component ?? '-'}\t${JSON.stringify(candidate.text)}${candidate.manual ? `\tMANUAL: ${candidate.manual}` : ''}`,
          )
        }
      }
      return
    }
    report(scan)
    return
  }
  if (command === 'convert') {
    const { convertFiles } = await import('./i18n-codemod')
    await convertFiles(args)
    return
  }
  throw new Error(
    'Usage: bun scripts/i18n-literals.ts <check|update|report [--files] [prefix...]|convert [--apply] <path...>>',
  )
}

if (import.meta.main) await main()

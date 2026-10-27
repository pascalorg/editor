import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { baseRevision, readAtRevision } from './i18n-git'

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

/** Legacy candidates per file, by text (a multiset: repeated copy appears once per use). */
export type Baseline = { version: 2; files: Record<string, string[]> }

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
  // Icon names, snake_case keys, paths and URLs. Hyphenated words ("Read-only", "zoom-in") are copy.
  if (/^[a-z0-9-]+(?:[_:./#][a-z0-9-]+)+$/i.test(trimmed)) return false
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
  return /i18n-ignore:\s*\S/.test(window)
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
  /** A `const` holding copy, rendered by name in JSX or a UI prop. */
  constant(node: ts.Identifier, text: string, kind: CandidateKind): void
}

/** `const NAME = 'Copy'` declarations anywhere in the file, by name. */
function stringConstants(
  source: ts.SourceFile,
): Map<string, ts.StringLiteral | ts.NoSubstitutionTemplateLiteral> {
  const constants = new Map<string, ts.StringLiteral | ts.NoSubstitutionTemplateLiteral>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of node.declarations) {
        const value = declaration.initializer
        if (
          ts.isIdentifier(declaration.name) &&
          value &&
          (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
        ) {
          constants.set(declaration.name.text, value)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return constants
}

function isNotifyOptions(node: ts.Node): boolean {
  const call = node.parent
  return (
    ts.isObjectLiteralExpression(node) &&
    !!call &&
    ts.isCallExpression(call) &&
    call.arguments[1] === node &&
    notifyCallee(call) !== undefined
  )
}

/** Walks every user-visible literal in one file. */
export function visitUiLiterals(
  source: ts.SourceFile,
  visitor: Visitor,
  allow: Set<string>,
  /** Plain modules are scanned for notifications only unless the codemod was pointed at them. */
  allKinds = source.fileName.endsWith('.tsx'),
): void {
  const notifyOnly = !allKinds
  const constants = stringConstants(source)
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
    if (ts.isIdentifier(expression)) {
      const value = constants.get(expression.text)
      if (
        value &&
        looksTranslatable(value.text, allow) &&
        !isIgnored(source, value) &&
        !isIgnored(source, expression)
      ) {
        visitor.constant(expression, value.text, kind)
      }
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
      !insideTranslationCall(node) &&
      !isNotifyOptions(node.parent)
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
      constant: (node, value, kind) =>
        add(node, kind, value, 'string constant: make it a descriptor or translate at the use'),
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

export function parseBaseline(text: string | undefined): Baseline | undefined {
  if (!text) return undefined
  const parsed = JSON.parse(text) as { version?: number; files?: Record<string, unknown> }
  return parsed.version === 2 ? (parsed as Baseline) : undefined
}

function readBaseline(): Baseline {
  return parseBaseline(readFileSync(BASELINE_PATH, 'utf8')) ?? { version: 2, files: {} }
}

/** The base branch's baseline, when the base has one (see `baseRevision`). */
function readBaseBaseline(): Baseline | undefined {
  const revision = baseRevision()
  return revision ? parseBaseline(readAtRevision(revision, BASELINE_PATH)) : undefined
}

function writeBaseline(scan: Map<string, Candidate[]>): void {
  const files = Object.fromEntries(
    [...scan.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, list]) => [path, list.map((candidate) => candidate.text).sort()]),
  )
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ version: 2, files } satisfies Baseline, null, 2)}\n`,
  )
}

/** Items of `values` left after removing one occurrence per item of `allowed`. */
function beyond(values: readonly string[], allowed: readonly string[]): string[] {
  const remaining = new Map<string, number>()
  for (const value of allowed) remaining.set(value, (remaining.get(value) ?? 0) + 1)
  return values.filter((value) => {
    const left = remaining.get(value) ?? 0
    if (left === 0) return true
    remaining.set(value, left - 1)
    return false
  })
}

/**
 * The ratchet: a file may only keep copy its baseline already lists, so new
 * or swapped copy fails, and a file absent from the baseline must have none.
 * The baseline itself may only shrink relative to the base branch; exempting
 * copy goes through `i18n/literal-allowlist.json` or an `i18n-ignore: <reason>`.
 */
export function checkLiterals(
  scan = scanRepository(),
  baseline = readBaseline(),
  base?: Baseline,
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
    const unknown = new Set(
      beyond(
        candidates.map((candidate) => candidate.text),
        baseline.files[path] ?? [],
      ),
    )
    if (unknown.size === 0) continue
    const listed = candidates
      .filter((candidate) => unknown.has(candidate.text))
      .map((candidate) => `    ${path}:${candidate.line} ${JSON.stringify(candidate.text)}`)
    errors.push(
      `${path}: untranslated user-visible literals not in the baseline. Wrap them with i18n._({ id, message }) or add an "i18n-ignore: <reason>" comment.\n${listed.join('\n')}`,
    )
  }
  for (const [path, allowed] of Object.entries(baseline.files)) {
    const left = beyond(
      allowed,
      (scan.get(path) ?? []).map((candidate) => candidate.text),
    )
    if (left.length > 0) improvable.push(`${path}: ${left.length} fewer`)
    const added = base ? beyond(allowed, base.files[path] ?? []) : []
    if (added.length > 0) {
      errors.push(
        `${path}: i18n/literal-baseline.json adds ${added.map((text) => JSON.stringify(text)).join(', ')} relative to the base branch; the baseline may only shrink`,
      )
    }
  }
  return { errors, improvable, total }
}

export function checkRepositoryLiterals() {
  return checkLiterals(scanRepository(), readBaseline(), readBaseBaseline())
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
    const { errors, improvable, total } = checkRepositoryLiterals()
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

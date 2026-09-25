import * as nodeFs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Metadata keys a source file reads or writes (R3 coverage for `metadata.*`,
 * which the schema types as an open record), found on the TypeScript AST.
 *
 * A metadata expression is the identifier `metadata`, any `x.metadata`, or a
 * record-helper call whose argument is one (`metaRecord(n.metadata)`), through parens,
 * `as`, `satisfies` and `!`.
 * - Reads: property and element access chains on it (`metadata?.a.b`,
 *   `metadata[KEY]`, `metadata['a']`), `'a' in metadata` and destructuring
 *   (`const { a, [KEY]: b } = metadata`).
 * - Writes: object literals assigned to a `metadata` property or variable,
 *   object-literal arguments of a call assigned to a `metadata` property, and
 *   object literals returned at the top level of a function whose name
 *   contains `metadata`. Inside a literal: plain, quoted and computed keys,
 *   shorthand and identifier values bound to a same-file literal (behind a
 *   condition, never a call), and spreads of conditional literals; nested
 *   literals yield `a.b` paths.
 * Computed keys resolve through same-file `const NAME = 'key'`.
 *
 * Test and tooling only: excluded from the package build.
 */
export function discoverMetadataKeys(source: string, fileName = 'source.tsx'): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const constants = new Map<string, string>()
  const bindings = new Map<string, ts.Expression>()
  const found = new Set<string>()

  const visitDeclarations = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer)
      if (ts.isStringLiteralLike(init)) constants.set(node.name.text, init.text)
      if (!bindings.has(node.name.text)) bindings.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visitDeclarations)
  }
  visitDeclarations(file)

  const keyOf = (name: ts.PropertyName | ts.Expression): string | undefined => {
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
    if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
    if (ts.isComputedPropertyName(name)) return keyOf(unwrap(name.expression))
    return undefined
  }
  const constantKey = (expression: ts.Expression): string | undefined => {
    const e = unwrap(expression)
    if (ts.isStringLiteralLike(e)) return e.text
    if (ts.isIdentifier(e)) return constants.get(e.text)
    return undefined
  }
  const computedKey = (name: ts.PropertyName): string | undefined =>
    ts.isComputedPropertyName(name) ? constantKey(name.expression) : keyOf(name)

  /** Object literals an expression evaluates to, through conditions and logic, never calls. */
  const literalsOf = (expression: ts.Expression, depth = 0): ts.ObjectLiteralExpression[] => {
    const e = unwrap(expression)
    if (ts.isObjectLiteralExpression(e)) return [e]
    if (ts.isConditionalExpression(e))
      return [...literalsOf(e.whenTrue, depth), ...literalsOf(e.whenFalse, depth)]
    if (ts.isBinaryExpression(e) && isLogical(e.operatorToken.kind))
      return [...literalsOf(e.left, depth), ...literalsOf(e.right, depth)]
    if (ts.isIdentifier(e) && depth < 4) {
      const bound = bindings.get(e.text)
      return bound ? literalsOf(bound, depth + 1) : []
    }
    return []
  }

  const collectLiteral = (literal: ts.ObjectLiteralExpression, prefix: string, depth: number) => {
    if (depth > 6) return
    for (const property of literal.properties) {
      if (ts.isSpreadAssignment(property)) {
        for (const inner of literalsOf(property.expression)) {
          if (inner !== literal) collectLiteral(inner, prefix, depth + 1)
        }
        continue
      }
      if (!property.name) continue
      const key = computedKey(property.name)
      if (key === undefined) continue
      const path = prefix ? `${prefix}.${key}` : key
      found.add(path)
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined
      if (value) for (const inner of literalsOf(value)) collectLiteral(inner, path, depth + 1)
    }
  }

  const collectWrite = (value: ts.Expression) => {
    const e = unwrap(value)
    if (ts.isCallExpression(e)) {
      for (const argument of e.arguments)
        for (const literal of literalsOf(argument)) collectLiteral(literal, '', 0)
      return
    }
    for (const literal of literalsOf(e)) collectLiteral(literal, '', 0)
  }

  const collectRead = (base: ts.Expression) => {
    const path: string[] = []
    let current: ts.Node = outermost(base)
    for (;;) {
      const parent: ts.Node = current.parent
      let key: string | undefined
      if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
        key = parent.name.text
        if (ARRAY_METHODS.has(key) && ts.isCallExpression(parent.parent)) break
      } else if (ts.isElementAccessExpression(parent) && parent.expression === current) {
        key = constantKey(parent.argumentExpression)
      }
      if (key === undefined) break
      path.push(key)
      current = outermost(parent as ts.Expression)
    }
    if (path.length > 0) found.add(path.join('.'))
  }

  const visit = (node: ts.Node) => {
    if (isMetadataExpression(node)) {
      collectRead(node as ts.Expression)
      const parent = outermost(node as ts.Expression).parent
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
        unwrap(parent.right) === unwrap(node as ts.Expression)
      ) {
        const key = constantKey(parent.left)
        if (key) found.add(key)
      }
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.left === outermost(node as ts.Expression)
      )
        collectWrite(parent.right)
    }
    if (ts.isPropertyAssignment(node) && keyOf(node.name) === 'metadata')
      collectWrite(node.initializer)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isMetadataExpression(unwrap(node.initializer))
    )
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue
        const name = element.propertyName ?? element.name
        const key = ts.isIdentifier(name)
          ? name.text
          : ts.isComputedPropertyName(name)
            ? constantKey(name.expression)
            : ts.isStringLiteralLike(name)
              ? name.text
              : undefined
        if (key) found.add(key)
      }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'metadata' &&
      node.initializer
    )
      for (const literal of literalsOf(node.initializer)) collectLiteral(literal, '', 0)
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name &&
      /metadata/i.test(node.name.text) &&
      node.body
    )
      for (const statement of node.body.statements)
        if (ts.isReturnStatement(statement) && statement.expression)
          for (const literal of literalsOf(statement.expression)) collectLiteral(literal, '', 0)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found].sort()
}

const ARRAY_METHODS = new Set([
  'length',
  'map',
  'filter',
  'some',
  'every',
  'find',
  'includes',
  'forEach',
  'entries',
  'keys',
  'values',
])

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function isLogical(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  )
}

/** Strips parens, `as`, `satisfies`, `!` and type assertions. */
function unwrap(expression: ts.Expression): ts.Expression {
  let e = expression
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
  )
    e = e.expression
  return e
}

/** The outermost wrapper (parens, casts, `!`) around an expression. */
function outermost(expression: ts.Expression): ts.Expression {
  let e: ts.Expression = expression
  while (
    ts.isParenthesizedExpression(e.parent) ||
    ts.isAsExpression(e.parent) ||
    ts.isSatisfiesExpression(e.parent) ||
    ts.isNonNullExpression(e.parent) ||
    ts.isTypeAssertionExpression(e.parent)
  )
    e = e.parent
  return e
}

/** `metadata`, `x.metadata`, `x?.metadata`, or a one-argument call wrapping one. */
function isMetadataExpression(node: ts.Node): boolean {
  if (ts.isIdentifier(node))
    return (
      node.text === 'metadata' &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !ts.isPropertyAssignment(node.parent) &&
      !ts.isVariableDeclaration(node.parent) &&
      !ts.isParameter(node.parent) &&
      !ts.isBindingElement(node.parent) &&
      !ts.isShorthandPropertyAssignment(node.parent)
    )
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'metadata'
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const argument = unwrap(node.arguments[0]!)
    return (
      /meta|record/i.test(node.expression.getText()) &&
      (ts.isIdentifier(argument) || ts.isPropertyAccessExpression(argument)) &&
      isMetadataExpression(argument)
    )
  }
  return false
}

/** The filesystem calls the source walk uses; injectable so tests can race it. */
export type ScanFs = Pick<typeof nodeFs, 'readdirSync' | 'statSync' | 'readFileSync'>

/**
 * Metadata keys of every non-test `.ts`/`.tsx` source under `roots`, each
 * mapped to the first file (relative to `base`) that reads or writes it.
 */
export function scanMetadataSources(
  base: string,
  roots: readonly string[],
  fs: ScanFs = nodeFs,
): Map<string, string> {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry)
      if (['node_modules', 'dist', '__fixtures__'].includes(entry)) return []
      if (fs.statSync(full).isDirectory()) return walk(full)
      return /\.tsx?$/.test(entry) && !/\.(test|spec|bench)\.tsx?$/.test(entry) ? [full] : []
    })
  const keys = new Map<string, string>()
  for (const root of roots)
    for (const file of walk(path.join(base, root)))
      for (const key of discoverMetadataKeys(fs.readFileSync(file, 'utf8'), file))
        if (!keys.has(key)) keys.set(key, path.relative(base, file))
  return keys
}

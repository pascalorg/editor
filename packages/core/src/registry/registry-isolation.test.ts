import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from '@typescript/typescript6'

// Bun runs a package's test files in one process, in an order that differs by platform: a file
// that leaves a definition behind (a stub `wall` with a loose schema) changes what a later file
// validates. `test-setup.ts` restores the registry around every test, which covers writes made in a
// test, a `beforeEach` or a helper they call. A write at file scope (top level, a `describe` body,
// `beforeAll`, or a call there to a helper of the file that writes) outlives every test of its
// file, so that file restores it itself (`nodeRegistry._snapshot()` in `afterAll`).
const WRITES = new Set(['registerNode', 'registerPlugin', 'loadPlugin'])
const REGISTRY_WRITES = new Set(['register', '_reset'])
const FILE_SCOPE_CALLS = new Set(['beforeAll', 'afterAll', 'describe'])

function isRegistryWrite(call: ts.CallExpression, helpers: ReadonlySet<string>): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return WRITES.has(callee.text) || helpers.has(callee.text)
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'nodeRegistry' &&
    REGISTRY_WRITES.has(callee.name.text)
  )
}

/** A named function's body: a declaration's, or a const arrow's or function expression's. */
function namedFunctions(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>()
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body)
      functions.set(node.name.text, node.body)
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      functions.set(node.name.text, node.initializer.body)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return functions
}

/** The file's own functions that write the registry, directly or through another of them. */
function writingHelpers(sourceFile: ts.SourceFile): Set<string> {
  const functions = namedFunctions(sourceFile)
  const helpers = new Set<string>()
  const writes = (body: ts.Node): boolean => {
    let found = false
    const visit = (node: ts.Node) => {
      if (found) return
      if (ts.isCallExpression(node) && isRegistryWrite(node, helpers)) found = true
      else ts.forEachChild(node, visit)
    }
    visit(body)
    return found
  }
  for (let grew = true; grew; ) {
    grew = false
    for (const [name, body] of functions)
      if (!helpers.has(name) && writes(body)) {
        helpers.add(name)
        grew = true
      }
  }
  return helpers
}

/** `describe`, `describe.each(…)`, `beforeAll`: the name a hook or suite is called by. */
function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return calleeName(expression.expression)
  if (ts.isCallExpression(expression)) return calleeName(expression.expression)
  return undefined
}

/** A write runs at file scope when no function encloses it but a suite or a file-scope hook. */
function atFileScope(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue
    const call = parent.parent
    if (!(call && ts.isCallExpression(call) && call.arguments.includes(parent as never)))
      return false
    if (!FILE_SCOPE_CALLS.has(calleeName(call.expression) ?? '')) return false
  }
  return true
}

function fileScopeWrites(file: string, source: string): number[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const helpers = writingHelpers(sourceFile)
  const lines: number[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isRegistryWrite(node, helpers) && atFileScope(node))
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return lines
}

test('a test file that writes the node registry at file scope restores it', () => {
  const root = join(import.meta.dir, '..')
  const leaking: string[] = []
  for (const file of new Bun.Glob('**/*.test.{ts,tsx}').scanSync(root)) {
    const source = readFileSync(join(root, file), 'utf8')
    const lines = fileScopeWrites(file, source)
    if (lines.length && !source.includes('_snapshot()')) leaking.push(`${file}:${lines.join(',')}`)
  }
  expect(leaking).toEqual([])
})

test('a write inside a test or beforeEach is the shared setup’s; one in beforeAll, or a helper called at file scope, is the file’s', () => {
  const source = `
    registerNode(a)
    describe('suite', () => {
      registerNode(b)
      beforeAll(() => nodeRegistry._reset())
      beforeEach(() => registerNode(c))
      test('one', () => { registerPlugin(d) })
    })
    function helper() { loadPlugin(e) }
    const stub = (kind) => helper(kind)
    stub('pipe')
    test('two', () => stub('duct'))
  `
  expect(fileScopeWrites('probe.test.ts', source)).toEqual([2, 4, 5, 11])
})

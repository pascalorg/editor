import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from '@typescript/typescript6'

/**
 * Layer rule (AGENTS.md): core is pure logic — no Three.js, no rendering.
 * A runtime `three`/`@react-three/*` import in core evaluates R3F (and thus
 * React client context) in every consumer of the barrel, which crashes
 * Next.js route handlers under the RSC server condition (capture uploads
 * 500'd this way once). Type-only imports are erased at build and allowed.
 */
const SRC = resolve(import.meta.dir)
const REPO = resolve(SRC, '../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const BANNED_SPEC = String.raw`(?:three(?:\/[^'"]*)?|@react-three\/[^'"]*)`
// `import`/`export … from 'three…'` — group 1 captures a whole-clause `type`
// qualifier, the only form guaranteed to be erased by the compiler.
const FROM_RE = new RegExp(
  String.raw`(?:import|export)\s+(type\s)?[\w*{}\s,$]*?from\s*['"]${BANNED_SPEC}['"]`,
  'g',
)
// Bare side-effect form: `import 'three…'` — always a runtime import.
const SIDE_EFFECT_RE = new RegExp(String.raw`import\s*['"]${BANNED_SPEC}['"]`, 'g')

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
}

function packageFiles(...dirs: string[]): string[] {
  return dirs.flatMap((dir) => sourceFiles(join(REPO, dir)))
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function contains(node: ts.Node, match: (node: ts.Node) => boolean): boolean {
  let found = false
  walk(node, (child) => {
    found ||= match(child)
  })
  return found
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return undefined
}

/** The nearest named declaration around `node`: how an allow-list entry names a site. */
function enclosingName(node: ts.Node): string {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (
      (ts.isVariableDeclaration(at) ||
        ts.isFunctionDeclaration(at) ||
        ts.isMethodDeclaration(at) ||
        ts.isPropertyAssignment(at)) &&
      at.name &&
      ts.isIdentifier(at.name)
    )
      return at.name.text
  }
  return '<file>'
}

type AllowList = Readonly<Record<string, readonly string[]>>

/**
 * Compares found sites (`path: name`, one per occurrence) with an allow-list of legacy sites.
 * The list only shrinks: a new site fails with `fix`, and a listed site that no longer violates
 * fails until its entry is deleted.
 */
function ratchet(found: string[], allowList: AllowList, listName: string, fix: string) {
  const remaining = Object.entries(allowList).flatMap(([path, names]) =>
    names.map((name) => `${path}: ${name}`),
  )
  const added: string[] = []
  for (const site of found) {
    const index = remaining.indexOf(site)
    if (index === -1) added.push(site)
    else remaining.splice(index, 1)
  }
  if (added.length > 0) throw new Error(`${fix}\n\n  ${added.join('\n  ')}`)
  if (remaining.length > 0)
    throw new Error(
      `These ${listName} entries in packages/core/src/architecture.test.ts no longer violate the rule. ` +
        `Delete them so the allow-list only shrinks:\n\n  ${remaining.join('\n  ')}`,
    )
}

/** Every built-in and core node kind, read from `nodeType('<kind>')` schema declarations. */
function nodeKinds(): Set<string> {
  const kinds = new Set<string>()
  for (const file of packageFiles('packages/core/src', 'packages/nodes/src'))
    for (const match of readFileSync(file, 'utf8').matchAll(/\bnodeType\('([a-z-]+)'\)/g))
      if (match[1] !== 'node') kinds.add(match[1]!)
  return kinds
}

// Legacy `case '<kind>'` arms on a node's type in viewer/editor, by file.
const KIND_SWITCH_LEGACY: AllowList = {
  'packages/editor/src/lib/geometry-script/author.ts': ['column', 'window', 'door'],
  'packages/editor/src/lib/point-ask/suggestions.ts': [
    'zone',
    'wall',
    'window',
    'door',
    'item',
    'procedural-item',
    'imported-mesh',
    'column',
    'roof',
    'roof-segment',
    'stair',
    'stair-segment',
  ],
  'packages/editor/src/lib/print-feature-thickness.ts': ['wall', 'slab', 'roof-segment'],
  'packages/viewer/src/ui/lib/node-display-label.ts': [
    'item',
    'wall',
    'door',
    'window',
    'cabinet',
    'cabinet-module',
    'slab',
    'ceiling',
    'roof',
    'fence',
    'column',
    'stair',
  ],
}

// Legacy `:move` handlers under packages/nodes that write useScene, by file → handler name.
const MOVE_WRITE_LEGACY: AllowList = {
  'packages/nodes/src/door/tool.tsx': ['onRoofHover'],
}

// Legacy Shift snap bypasses (wiki/architecture/interaction-scope.md, Known-legacy), by file →
// enclosing declaration.
const SHIFT_SNAP_LEGACY: AllowList = {
  'packages/editor/src/components/editor/floorplan-panel.tsx': ['bypassSnap', 'bypassSnap'],
  'packages/nodes/src/building/move-tool.tsx': ['bypassSnap'],
  'packages/nodes/src/shared/polygon-centroid-move.ts': ['snap'],
}

describe('architecture', () => {
  test('core has no runtime three/@react-three imports', () => {
    const files = sourceFiles(SRC)
    const offenders: string[] = []

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const match of src.matchAll(FROM_RE)) {
        if (!match[1]) offenders.push(`${relative(SRC, file)}: ${match[0].replaceAll('\n', ' ')}`)
      }
      for (const match of src.matchAll(SIDE_EFFECT_RE)) {
        offenders.push(`${relative(SRC, file)}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
    // Guard against the walk passing vacuously.
    expect(files.length).toBeGreaterThan(100)
  })

  // Discriminants that hold a node kind: `<expr>.type` or a `nodeType` variable. Other switches
  // whose labels happen to match a kind (breadcrumbs, panels, annotation roles) are not dispatch.
  test('viewer and editor add no switch arms on a node kind', () => {
    const kinds = nodeKinds()
    const files = packageFiles('packages/viewer/src', 'packages/editor/src')
    const found: string[] = []
    for (const file of files) {
      const sourceFile = parse(file)
      walk(sourceFile, (node) => {
        if (!ts.isSwitchStatement(node)) return
        const discriminant = node.expression
        const onKind =
          (ts.isPropertyAccessExpression(discriminant) && discriminant.name.text === 'type') ||
          (ts.isIdentifier(discriminant) && discriminant.text === 'nodeType')
        if (!onKind) return
        for (const clause of node.caseBlock.clauses)
          if (
            ts.isCaseClause(clause) &&
            ts.isStringLiteralLike(clause.expression) &&
            kinds.has(clause.expression.text)
          )
            found.push(`${relative(REPO, file)}: ${clause.expression.text}`)
      })
    }

    expect(kinds.size).toBeGreaterThan(50)
    expect(files.length).toBeGreaterThan(200)
    ratchet(
      found,
      KIND_SWITCH_LEGACY,
      'KIND_SWITCH_LEGACY',
      "A `case '<kind>'` arm on a node's type puts per-kind behaviour in framework code. " +
        'Put it on the kind’s NodeDefinition in packages/nodes/src/<kind>/ (a definition field or ' +
        'capability) and read it through nodeRegistry.get(node.type). See DECISIONS.md E-002.',
    )
  })

  test('node pointer-move handlers do not write the scene store', () => {
    const files = packageFiles('packages/nodes/src')
    const found: string[] = []
    let handlers = 0
    for (const file of files) {
      const sourceFile = parse(file)
      const functions = new Map<string, ts.Node>()
      walk(sourceFile, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body)
          functions.set(node.name.text, node)
        else if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        )
          functions.set(node.name.text, node)
      })
      walk(sourceFile, (node) => {
        if (!ts.isCallExpression(node) || calleeName(node) !== 'on') return
        const [event, handler] = node.arguments
        if (!event || !handler || !ts.isStringLiteralLike(event) || !event.text.endsWith(':move'))
          return
        const body = ts.isIdentifier(handler) ? functions.get(handler.text) : handler
        if (!body) return
        handlers++
        const writes = (child: ts.Node) =>
          ts.isCallExpression(child) && /^updateNodes?$/.test(calleeName(child) ?? '')
        if (contains(body, writes))
          found.push(
            `${relative(REPO, file)}: ${ts.isIdentifier(handler) ? handler.text : enclosingName(node)}`,
          )
      })
    }

    expect(handlers).toBeGreaterThan(50)
    ratchet(
      found,
      MOVE_WRITE_LEGACY,
      'MOVE_WRITE_LEGACY',
      'A `:move` handler calls updateNode/updateNodes, which swaps the scene’s nodes map and ' +
        're-renders every useScene(s => s.nodes) subscriber on each pointer move. Preview through ' +
        'useLiveNodeOverrides / useLiveTransforms (or the registered mesh) and write useScene once ' +
        'on commit. See DECISIONS.md E-007 and wiki/architecture/tools.md § "Data-driven live drag".',
    )
  })

  // A Shift read that picks between a quantized and a raw value, or that sets a
  // `bypassSnap`-style flag. Shift for multi-select, rotation direction or sounds is fine.
  test('Shift does not bypass snapping', () => {
    const files = packageFiles('packages/nodes/src', 'packages/editor/src')
    const found: string[] = []
    const readsShift = (node: ts.Node) =>
      contains(
        node,
        (child) =>
          (ts.isPropertyAccessExpression(child) && child.name.text === 'shiftKey') ||
          (ts.isIdentifier(child) && child.text === 'shiftKey'),
      )
    const quantizes = (node: ts.Node) =>
      contains(
        node,
        (child) =>
          ts.isCallExpression(child) &&
          (child.expression.getText() === 'Math.round' ||
            /snap|quantize/i.test(calleeName(child) ?? '')),
      )
    for (const file of files) {
      const sourceFile = parse(file)
      const sites = new Map<ts.Node, string>()
      walk(sourceFile, (node) => {
        const bypassFlag =
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          /(bypass|skip|disable|ignore|no)_?snap/i.test(node.name.text) &&
          node.initializer !== undefined &&
          readsShift(node.initializer)
        const shiftPicksSnap =
          ts.isConditionalExpression(node) &&
          readsShift(node.condition) &&
          quantizes(node.whenTrue) !== quantizes(node.whenFalse)
        if (bypassFlag || shiftPicksSnap) sites.set(node, enclosingName(node))
      })
      for (const [node, name] of sites)
        if (!hasFlaggedAncestor(node, sites)) found.push(`${relative(REPO, file)}: ${name}`)
    }

    expect(files.length).toBeGreaterThan(200)
    ratchet(
      found,
      SHIFT_SNAP_LEGACY,
      'SHIFT_SNAP_LEGACY',
      'Shift does not bypass snapping: a Shift tap cycles the snap mode and a held Alt forces the ' +
        'raw cursor. Drop the shiftKey read and gate on the mode instead, e.g. ' +
        '`const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0`, or ' +
        'isMagneticSnapActive() / isAngleSnapActive(). See DECISIONS.md E-004.',
    )
  })
})

function hasFlaggedAncestor(node: ts.Node, sites: Map<ts.Node, string>): boolean {
  for (let at = node.parent; at; at = at.parent) if (sites.has(at)) return true
  return false
}

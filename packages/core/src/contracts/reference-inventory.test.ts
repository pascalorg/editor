/**
 * Existing-reference inventory coverage (A-02, R3).
 *
 * - Every reference candidate in the schema AST, including host-derived
 *   dependents, is classified, and no row is stale.
 * - Every metadata key any editor source reads or writes is classified.
 * - Dependents share their reference's lifecycle: a preset strip clears them
 *   together.
 * - Label namespaces are never validated as node references.
 * - The clone columns match what the three clone passes do today.
 * - Every rule R1–R9 names existing gates and existing tests.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { cloneNodesInto } from '../registry/subtree'
import { type AnyNode, type AnyNodeId, AnyNode as AnyNodeSchema, nodeKindOf } from '../schema/types'
import { cloneLevelSubtree, cloneSceneGraph } from '../utils/clone-scene-graph'
import { discoverMetadataKeys } from './metadata-scan'
import { discoverReferenceCandidates } from './reference-discovery'
import {
  EXISTING_REFERENCES,
  type ExistingReference,
  METADATA_NON_REFERENCES,
  METADATA_REFERENCES,
  metadataKeyClassified,
  NON_REFERENCES,
  type ReferenceRemapSite,
} from './reference-inventory'
import { FIDELITY_GATES, RULE_GUARDS } from './rules'

const OPTIONS = AnyNodeSchema.options
const KINDS: string[] = OPTIONS.map(nodeKindOf)
const CANDIDATES = new Map<string, string[]>(
  OPTIONS.map((o) => [nodeKindOf(o), discoverReferenceCandidates(o)]),
)

const appliesTo = (row: { kind: string }, kind: string) => row.kind === kind || row.kind === '*'
const rowMatches = (row: { kind: string; path: string }, kind: string, path: string) =>
  appliesTo(row, kind) && row.path === path
const isDependent = (kind: string, path: string) =>
  EXISTING_REFERENCES.some((row) => appliesTo(row, kind) && row.dependents?.includes(path))

describe('existing-reference inventory (R3)', () => {
  test('every reference candidate in the schema AST is classified', () => {
    const unclassified: string[] = []
    for (const [kind, paths] of CANDIDATES) {
      for (const path of paths) {
        const known =
          EXISTING_REFERENCES.some((row) => rowMatches(row, kind, path)) ||
          isDependent(kind, path) ||
          NON_REFERENCES.some((row) => rowMatches(row, kind, path))
        if (!known) unclassified.push(`${kind}: ${path}`)
      }
    }
    expect(unclassified).toEqual([])
  })

  test('no row is stale: each persisted path exists on its kind', () => {
    const stale: string[] = []
    for (const row of [...EXISTING_REFERENCES, ...NON_REFERENCES]) {
      if (row.kind === '#scene' || row.path === '#linkedBy') continue
      const kinds = row.kind === '*' ? KINDS : [row.kind]
      if (!kinds.some((kind) => CANDIDATES.get(kind)?.includes(row.path)))
        stale.push(`${row.kind}: ${row.path}`)
      for (const dependent of 'dependents' in row ? (row.dependents ?? []) : [])
        if (!kinds.some((kind) => CANDIDATES.get(kind)?.includes(dependent)))
          stale.push(`${row.kind}: ${row.path} → ${dependent}`)
    }
    expect(stale).toEqual([])
  })

  test('rows are well formed and namespaces never mix', () => {
    const problems: string[] = []
    const cloneSites: ReferenceRemapSite[] = [
      'clone-scene-graph',
      'clone-level-subtree',
      'clone-nodes-into',
    ]
    const seen = new Set<string>()
    for (const row of EXISTING_REFERENCES) {
      const id = `${row.kind}:${row.path}:${row.prefix ?? ''}`
      if (seen.has(id)) problems.push(`duplicate ${id}`)
      seen.add(id)
      if (row.extractor === 'prefixed' && !row.prefix) problems.push(`${id} lacks a prefix`)
      if (row.extractor === 'linked-by' && !row.linkedBy) problems.push(`${id} lacks linkedBy`)
      for (const target of row.targetKinds ?? [])
        if (!KINDS.includes(target)) problems.push(`${id} targets unknown kind ${target}`)
      // A clone mints node ids only; it must never rewrite a part, surface,
      // asset, material or source id.
      if (row.namespace !== 'node' && row.namespace !== 'collection')
        for (const site of cloneSites)
          if (row.remaps.includes(site)) problems.push(`${id} is ${row.namespace} but ${site}`)
      if (row.role === 'content' && !['asset', 'material', 'source'].includes(row.namespace))
        problems.push(`${id}: content role on ${row.namespace}`)
      if (row.namespace === 'label' && row.targetKinds)
        problems.push(`${id}: a label never targets a kind`)
    }
    expect(problems).toEqual([])
  })

  test('covers each reference family the plan names', () => {
    const has = (kind: string, path: string, check?: (r: ExistingReference) => boolean) =>
      EXISTING_REFERENCES.some((r) => r.kind === kind && r.path === path && (check?.(r) ?? true))
    expect(has('*', 'parentId')).toBe(true)
    expect(has('*', 'children[]')).toBe(true)
    expect(has('roof', 'support.roofSegmentId')).toBe(true)
    expect(has('*', 'supportSlabId', (r) => r.sentinels?.includes('ground') === true)).toBe(true)
    expect(has('#scene', 'collections.*.nodeIds[]')).toBe(true)
    expect(has('item', 'collectionIds[]', (r) => r.namespace === 'collection')).toBe(true)
    expect(has('unit', 'members[]')).toBe(true)
    expect(has('measurement', 'measurement.points[].reference.nodeId')).toBe(true)
    expect(has('#scene', 'collections.*.controlNodeId', (r) => r.role === 'control')).toBe(true)
    expect(has('procedural-item', 'attachments.@key')).toBe(true)
    expect(has('*', 'hangerOverrides.*.hostId')).toBe(true)
    expect(has('wall', '#linkedBy', (r) => r.linkedBy === 'endpoint-match')).toBe(true)
    expect(has('scan', 'captureSession.sessionId', (r) => r.namespace === 'source')).toBe(true)
    for (const namespace of ['node', 'part', 'surface', 'asset', 'source'] as const)
      expect(EXISTING_REFERENCES.some((r) => r.namespace === namespace)).toBe(true)
  })
})

// ─── metadata.* ───────────────────────────────────────────────────────────

const EDITOR_ROOT = path.resolve(import.meta.dir, '../../../..')
const SOURCE_ROOTS = [
  ...readdirSync(path.join(EDITOR_ROOT, 'packages')).map((p) => `packages/${p}/src`),
  'apps/editor/app',
  'apps/editor/components',
  'apps/editor/lib',
].filter((root) => existsSync(path.join(EDITOR_ROOT, root)))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (['node_modules', 'dist', '__fixtures__'].includes(entry)) return []
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !/\.(test|spec|bench)\.tsx?$/.test(entry) ? [full] : []
  })
}

const METADATA_KEYS = new Map<string, string>()
for (const root of SOURCE_ROOTS)
  for (const file of sourceFiles(path.join(EDITOR_ROOT, root)))
    for (const key of discoverMetadataKeys(readFileSync(file, 'utf8'), file))
      if (!METADATA_KEYS.has(key)) METADATA_KEYS.set(key, path.relative(EDITOR_ROOT, file))

describe('metadata references (R3)', () => {
  test('the scanner reads and writes nested, computed and conditional keys', () => {
    const keys = discoverMetadataKeys(`
      const OWNER = 'ownerKey'
      const debug = hit ? { wallId: hit.id, gap: 0.1 } : undefined
      const node = { metadata: { [OWNER]: a.id, debug, ...(x ? { sourceId: x } : {}) } }
      const read = (n.metadata as Record<string, unknown>)?.proxyId
      const deep = n.metadata?.link.runIds
      // metadata.commentedOut
      const text = 'metadata.inString // not a comment'
      const url = 'https://example.com'; const after = n.metadata.afterUrl
      const tpl = \`\${n.metadata.inTemplate} metadata.inTemplateText\`
      const has = 'role' in level.metadata
      const record = metadataRecord(x.metadata).viaHelper
      x.metadata = { assigned: 1 }
      function seedMetadata() { return { returned: true } }
    `)
    expect(keys).toEqual([
      'afterUrl',
      'assigned',
      'debug',
      'debug.gap',
      'debug.wallId',
      'inTemplate',
      'link.runIds',
      'ownerKey',
      'proxyId',
      'returned',
      'role',
      'sourceId',
      'viaHelper',
    ])
  })

  test('every metadata key an editor source reads or writes is classified', () => {
    expect(METADATA_KEYS.size).toBeGreaterThan(50)
    const unclassified = [...METADATA_KEYS]
      .filter(([key]) => !metadataKeyClassified(key, METADATA_REFERENCES, METADATA_NON_REFERENCES))
      .map(([key, file]) => `${key} (${file})`)
    expect(unclassified).toEqual([])
  })

  test('no metadata row is stale', () => {
    const bare = (p: string) => p.replace(/^metadata\./, '').replace(/\[\]/g, '')
    const found = [...METADATA_KEYS.keys()]
    const stale = [
      ...METADATA_REFERENCES.flatMap((row) => [row.path, ...(row.dependents ?? [])]),
      ...METADATA_NON_REFERENCES.map((row) => row.path),
    ]
      .map(bare)
      .filter((p) => !found.some((key) => p === key || p.startsWith(`${key}.`)))
    expect(stale).toEqual([])
  })
})

// ─── Dependents and labels ────────────────────────────────────────────────

/** Reference preset save: strip every `strip` reference and its dependents together. */
function presetStrip(kind: string, node: Loose): Loose {
  const out = structuredClone(node)
  for (const row of [...EXISTING_REFERENCES, ...METADATA_REFERENCES]) {
    if (!appliesTo(row, kind) || row.onPreset !== 'strip') continue
    for (const p of [row.path, ...(row.dependents ?? [])]) {
      const segments = p.split('.')
      let cursor: Loose | undefined = out
      for (const segment of segments.slice(0, -1)) cursor = cursor?.[segment] as Loose | undefined
      if (cursor && typeof cursor === 'object') delete cursor[segments.at(-1)!.replace('[]', '')]
    }
  }
  return out
}

describe('dependents share their reference lifecycle', () => {
  test('a preset strip clears host ids with their side, face, station and UVs', () => {
    const item = presetStrip('item', {
      wallId: 'wall_a',
      wallT: 0.4,
      side: 'front',
      roofSegmentId: 'rseg_a',
      roofFace: 'left',
      blockFaceId: 'f-top',
      supportSlabId: 'slab_a',
      name: 'lamp',
    })
    expect(item).toEqual({ name: 'lamp' })
    const window = presetStrip('window', {
      wallId: 'w',
      side: 'back',
      dormerId: 'd',
      dormerFace: 'front',
      width: 1,
    })
    expect(window).toEqual({ width: 1 })
    const leanTo = presetStrip('lean-to-extension', {
      hostRoofSegmentId: 'rseg_a',
      hostRoofEdge: 'front',
      hostRoofEdgeRange: [0, 1],
      depth: 2,
    })
    expect(leanTo).toEqual({ depth: 2 })
    const run = presetStrip('duct-segment', {
      wallAttachment: {
        wallId: 'wall_a',
        side: 'front',
        startUV: [0, 1],
        endUV: [1, 1],
        offset: 0.05,
      },
    })
    expect(run).toEqual({ wallAttachment: {} })
  })
})

describe('label namespaces are never validated as node references', () => {
  /** Inventory-driven validation: every `node` reference must resolve or be a sentinel. */
  function dangling(kind: string, node: Loose, nodes: Record<string, unknown>): string[] {
    return EXISTING_REFERENCES.filter((row) => appliesTo(row, kind) && row.namespace === 'node')
      .filter((row) => row.extractor === 'path' && row.path !== 'parentId')
      .flatMap((row) =>
        getAt(node, row.path)
          .filter((v): v is string => typeof v === 'string')
          .filter((v) => !nodes[v] && !row.sentinels?.includes(v))
          .map((v) => `${row.path}=${v}`),
      )
  }

  test('bench-style source-face joins and lean-to joins both validate', () => {
    const faceJoin = { shedJointOwnerId: 'face-3', shedJointNeighborIds: ['face-3'] }
    const leanToJoin = {
      shedJointOwnerId: 'leanto_a',
      shedJointNeighborIds: ['leanto_b'],
      shedJointScopeId: 'level_1',
    }
    expect(dangling('roof-segment', faceJoin, {})).toEqual([])
    expect(dangling('roof-segment', leanToJoin, {})).toEqual([])
    for (const path of ['shedJointOwnerId', 'shedJointNeighborIds[]', 'shedJointScopeId'])
      expect(EXISTING_REFERENCES.find((r) => r.path === path)?.namespace).toBe('label')
    // A real node reference still dangles.
    expect(dangling('zone', { boundaryWallIds: ['wall_gone'] }, {})).toEqual([
      'boundaryWallIds[]=wall_gone',
    ])
  })
})

describe('source-namespace provenance (R9)', () => {
  test('capture and IFC provenance ids are source references, never remapped', () => {
    const sources = [...EXISTING_REFERENCES, ...METADATA_REFERENCES].filter(
      (r) => r.namespace === 'source',
    )
    expect(sources.map((r) => r.path)).toEqual(
      expect.arrayContaining(['captureSession.sessionId', 'metadata.globalId']),
    )
    for (const row of sources) expect(row.remaps).toEqual([])
  })
})

// ─── R1–R9 guards ─────────────────────────────────────────────────────────

describe('every rule R1–R9 names existing gates and tests', () => {
  test('rules R1–R9 each have a guard', () => {
    expect(Object.keys(RULE_GUARDS)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'])
    for (const guard of Object.values(RULE_GUARDS))
      expect(guard.checks.length + guard.gates.length).toBeGreaterThan(0)
  })

  test('each named gate is in the checked-in gate list', () => {
    const gates: readonly string[] = FIDELITY_GATES
    const missing = Object.entries(RULE_GUARDS).flatMap(([rule, guard]) =>
      guard.gates.filter((gate) => !gates.includes(gate)).map((gate) => `${rule}: ${gate}`),
    )
    expect(missing).toEqual([])
  })

  test('each named check is an existing test title in an existing file', () => {
    const missing = Object.entries(RULE_GUARDS).flatMap(([rule, guard]) =>
      guard.checks
        .filter(({ file, title }) => {
          const full = path.resolve(import.meta.dir, '..', file)
          if (!existsSync(full)) return true
          const source = readFileSync(full, 'utf8')
          return !source.includes(`describe('${title}'`) && !source.includes(`test('${title}'`)
        })
        .map(({ file, title }) => `${rule}: ${file} › ${title}`),
    )
    expect(missing).toEqual([])
  })
})

// ─── Clone columns, executed ──────────────────────────────────────────────

type Loose = Record<string, unknown>

/** Writes `value` at a `ReferencePath`, creating one-element arrays and a record keyed `k`. */
function setAt(target: Loose, path: string, value: string): void {
  const segments = path.replace(/\[\]/g, '.[]').split('.')
  let cursor: unknown = target
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const last = i === segments.length - 1
    if (segment === '[]') {
      const array = cursor as unknown[]
      if (last) array.push(value)
      else {
        if (array.length === 0) array.push(segments[i + 1] === '[]' ? [] : {})
        cursor = array[0] as Loose
      }
      continue
    }
    const record = cursor as Loose
    const key = segment === '*' ? 'k' : segment
    if (segment === '@key') {
      record[value] = 'v'
      return
    }
    if (last) record[key] = value
    else {
      const next = segments[i + 1]
      record[key] ??= next === '[]' ? [] : {}
      cursor = record[key] as Loose
    }
  }
}

/** Reads every value at a `ReferencePath`. */
function getAt(source: unknown, path: string): unknown[] {
  let values: unknown[] = [source]
  for (const segment of path.replace(/\[\]/g, '.[]').split('.')) {
    values = values.flatMap((value) => {
      if (value === null || typeof value !== 'object') return []
      if (segment === '[]') return Array.isArray(value) ? value : []
      if (segment === '*') return Object.values(value)
      if (segment === '@key') return Object.keys(value)
      return segment in value ? [(value as Loose)[segment]] : []
    })
  }
  return values
}

const anchorTo = (nodeId: string) => ({
  kind: 'feature',
  reference: { nodeId, featureId: 'f' },
  fallback: [0, 0, 0],
})

/** Discriminated branches the generic writer cannot reach. */
const SEEDS: Record<string, (target: string) => Loose> = {
  'roof:support.roofSegmentId': (t) => ({ support: { kind: 'roof', roofSegmentId: t } }),
  'construction-dimension:controllingDimensionId': (t) => ({
    anchors: [],
    controllingDimensionId: t,
  }),
  'measurement:measurement.points[].reference.nodeId': (t) => ({
    measurement: { kind: 'distance', points: [anchorTo(t), anchorTo(t)] },
  }),
  'measurement:measurement.base[].reference.nodeId': (t) => ({
    measurement: { kind: 'area', base: [anchorTo(t), anchorTo(t), anchorTo(t)] },
  }),
}

const ID_PREFIX: Record<string, string> = { 'roof-segment': 'rseg', 'lean-to-extension': 'leanto' }
const idFor = (kind: string, name: string) => `${ID_PREFIX[kind] ?? kind}_${name}`

type Scenario = { nodes: Record<string, Loose>; levelId: string; ownerId: string; targetId: string }

function scenario(kind: string, row: ExistingReference): Scenario {
  const level = {
    id: 'level_l',
    type: 'level',
    name: 'level',
    parentId: null,
    children: [] as string[],
  }
  const owner: Loose = { id: idFor(kind, 'owner'), type: kind, name: 'owner', parentId: level.id }
  const targetKind = row.targetKinds?.[0] ?? 'item'
  const target: Loose = {
    id: idFor(targetKind, 'target'),
    type: targetKind,
    name: 'target',
    ...(targetKind === 'construction-dimension' ? { anchors: [] } : {}),
  }
  const ownerId = owner.id as string
  const targetId = target.id as string
  if (row.path === 'parentId') {
    Object.assign(target, { parentId: level.id, children: [ownerId] })
    owner.parentId = targetId
    level.children = [targetId]
  } else if (row.path === 'children[]') {
    Object.assign(owner, { children: [targetId] })
    target.parentId = ownerId
    level.children = [ownerId]
  } else {
    target.parentId = level.id
    level.children = [ownerId, targetId]
    const seed = SEEDS[`${row.kind}:${row.path}`]
    if (seed) Object.assign(owner, seed(targetId))
    else setAt(owner, row.path, targetId)
  }
  return {
    nodes: { [level.id]: level, [ownerId]: owner, [targetId]: target },
    levelId: level.id,
    ownerId,
    targetId,
  }
}

type Outcome = 'remapped' | 'kept'

function outcome(values: unknown[], originalTarget: string, clonedTarget: string): Outcome {
  if (values.length === 0) throw new Error('reference vanished in the clone')
  if (values.every((v) => v === clonedTarget)) return 'remapped'
  if (values.every((v) => v === originalTarget)) return 'kept'
  throw new Error(`unexpected clone values ${JSON.stringify(values)}`)
}

const byName = (nodes: Iterable<unknown>, name: string) =>
  [...nodes].find((node) => (node as Loose).name === name) as Loose

function observeClones(kind: string, row: ExistingReference): Record<string, Outcome> {
  const { nodes, levelId, ownerId, targetId } = scenario(kind, row)
  const graph = cloneSceneGraph({
    nodes: nodes as unknown as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [levelId as AnyNodeId],
  })
  const level = cloneLevelSubtree(
    nodes as unknown as Record<AnyNodeId, AnyNode>,
    levelId as AnyNodeId,
  )
  const into = cloneNodesInto(Object.values(nodes) as unknown as AnyNode[], {
    rootId: levelId as AnyNodeId,
  })
  const read = (all: Iterable<unknown>) =>
    outcome(getAt(byName(all, 'owner'), row.path), targetId, byName(all, 'target').id as string)
  void ownerId
  return {
    'clone-scene-graph': read(Object.values(graph.nodes)),
    'clone-level-subtree': read(level.clonedNodes),
    'clone-nodes-into': read(into.nodes),
  }
}

describe('clone columns match today (R3 extractor evidence)', () => {
  const rows = EXISTING_REFERENCES.filter(
    (row) => row.namespace === 'node' && row.kind !== '#scene' && row.extractor === 'path',
  )
  for (const row of rows) {
    const kind =
      row.kind === '*' ? KINDS.find((k) => CANDIDATES.get(k)?.includes(row.path))! : row.kind
    test(`${row.kind} ${row.path}`, () => {
      const observed = observeClones(kind, row)
      for (const site of [
        'clone-scene-graph',
        'clone-level-subtree',
        'clone-nodes-into',
      ] as const) {
        expect({ site, outcome: observed[site] }).toEqual({
          site,
          outcome: row.remaps.includes(site) ? 'remapped' : 'kept',
        })
      }
    })
  }

  test("supportSlabId keeps the 'ground' sentinel", () => {
    const nodes = {
      level_l: { id: 'level_l', type: 'level', parentId: null, children: ['item_a'] },
      item_a: { id: 'item_a', type: 'item', parentId: 'level_l', supportSlabId: 'ground' },
    } as unknown as Record<AnyNodeId, AnyNode>
    const cloned = Object.values(
      cloneSceneGraph({ nodes, rootNodeIds: ['level_l' as AnyNodeId] }).nodes,
    )
    expect(cloned.map((n) => (n as Loose).supportSlabId).filter(Boolean)).toEqual(['ground'])
  })

  test('scene-root collections and roots', () => {
    const nodes = {
      level_l: { id: 'level_l', type: 'level', parentId: null, children: ['item_a', 'item_b'] },
      item_a: { id: 'item_a', type: 'item', parentId: 'level_l', collectionIds: ['collection_c'] },
      item_b: { id: 'item_b', type: 'item', parentId: 'level_l' },
    } as unknown as Record<AnyNodeId, AnyNode>
    const collections = {
      collection_c: {
        id: 'collection_c',
        name: 'c',
        nodeIds: ['item_a' as AnyNodeId],
        controlNodeId: 'item_b' as AnyNodeId,
      },
    } as never
    const graph = cloneSceneGraph({ nodes, rootNodeIds: ['level_l' as AnyNodeId], collections })
    const [collection] = Object.values(graph.collections ?? {})
    expect(Object.keys(graph.nodes)).toContain(graph.rootNodeIds[0]!)
    expect(Object.keys(graph.nodes)).toContain(collection!.nodeIds[0]!)
    expect(Object.keys(graph.nodes)).toContain(collection!.controlNodeId!)
    const itemA = Object.values(graph.nodes).find((n) => (n as Loose).collectionIds) as Loose
    expect(itemA.collectionIds).toEqual([collection!.id])
  })
})

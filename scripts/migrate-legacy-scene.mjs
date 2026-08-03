#!/usr/bin/env bun
/**
 * Migrates a scene from the legacy desktop build ("Digital Twin V2" / Pascal,
 * scenes in a local `pascal.db` SQLite file or per-scene JSON backups) into
 * the current graph format accepted by `POST /api/scenes`.
 *
 * The legacy build had no warehouse plugin: racking was a generic `item` node
 * carrying `asset.src === "asset://procedural/<kind>"` plus a bounding-box
 * `dimensions` triple. The current build models those as parametric
 * `warehouse:*` nodes, so this is a representation change, not a rename —
 * each procedural item is rebuilt as the matching plugin node and everything
 * else passes through untouched.
 *
 * Safety contract: an unrecognised procedural kind ABORTS the migration with
 * a report — nodes are never silently dropped, because a skipped rack is a
 * rack missing from the customer's floor. The output graph is validated with
 * the same `apiGraphSchema` the server enforces, so a migration that prints
 * "ok" is one the API will accept.
 *
 * Usage:
 *   bun scripts/migrate-legacy-scene.mjs --json <backup.json> [--out <file>]
 *   bun scripts/migrate-legacy-scene.mjs --db <pascal.db> --scene <id> [--out <file>]
 *   bun scripts/migrate-legacy-scene.mjs --db <pascal.db> --list
 *   bun scripts/migrate-legacy-scene.mjs ... --drop-transient
 */

import fs from 'node:fs'
import path from 'node:path'

const WAREHOUSE_PLUGIN_ID = 'ovurrsl:warehouse'

/** Effective size after folding a legacy node's scale into its asset box. */
function effectiveDimensions(node) {
  const dims = Array.isArray(node.asset?.dimensions) ? node.asset.dimensions : [1, 1, 1]
  const scale = Array.isArray(node.scale) ? node.scale : [1, 1, 1]
  return [0, 1, 2].map((i) => (Number(dims[i]) || 1) * (Number(scale[i]) || 1))
}

function clampWithNote(value, lo, hi, label, notes) {
  if (value < lo || value > hi) {
    notes.push(`${label}=${value} şema sınırına kırpıldı [${lo}, ${hi}]`)
    return Math.min(hi, Math.max(lo, value))
  }
  return value
}

function migratedId(oldId, prefix) {
  const suffix = oldId.includes('_') ? oldId.slice(oldId.indexOf('_') + 1) : oldId
  return `${prefix}_${suffix}`
}

function baseFields(node) {
  return {
    object: 'node',
    id: node.id,
    name: node.name,
    parentId: node.parentId ?? null,
    visible: node.visible ?? true,
    metadata: stripTransient(node.metadata),
    position: node.position ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0],
  }
}

/** A migrated object is a real placed object, not an in-progress preview. */
function stripTransient(metadata) {
  if (!metadata || typeof metadata !== 'object') return {}
  const { isTransient, ...rest } = metadata
  return rest
}

/**
 * Legacy procedural kind → converter. The migration target side; extend this
 * table as the legacy inventory surfaces more kinds. Every converter maps the
 * legacy bounding box onto the parametric fields whose defaults produce the
 * closest visual match, and leaves every other parameter to the schema's
 * defaults.
 */
const PROCEDURAL_CONVERTERS = {
  'asset://procedural/rack': (node, notes) => {
    const [w, h, d] = effectiveDimensions(node)
    return {
      ...baseFields(node),
      id: migratedId(node.id, 'pallet-rack'),
      type: 'warehouse:pallet-rack',
      bayClearWidth: clampWithNote(w, 0.6, 6, `${node.id} genişlik`, notes),
      uprightHeight: clampWithNote(h, 1, 20, `${node.id} yükseklik`, notes),
      depth: clampWithNote(d, 0.4, 2.5, `${node.id} derinlik`, notes),
    }
  },
}

function isLegacyProceduralItem(node) {
  return (
    node?.type === 'item' &&
    typeof node.asset?.src === 'string' &&
    node.asset.src.startsWith('asset://procedural/')
  )
}

/**
 * Converts a legacy graph in place-of (returns a new graph plus a report).
 * Throws MigrationError when a procedural kind has no converter.
 */
export class MigrationError extends Error {
  constructor(message, details) {
    super(message)
    this.details = details
  }
}

export function migrateLegacyGraph(legacyGraph, { dropTransient = false } = {}) {
  const report = {
    converted: [],
    passedThrough: 0,
    droppedTransient: [],
    repairedParentIds: 0,
    notes: [],
  }

  const nodes = structuredClone(legacyGraph.nodes ?? {})
  let rootNodeIds = [...(legacyGraph.rootNodeIds ?? [])]

  if (dropTransient) {
    for (const [id, node] of Object.entries(nodes)) {
      if (node?.metadata?.isTransient === true) {
        delete nodes[id]
        report.droppedTransient.push(id)
      }
    }
  }

  const unknown = []
  const idMap = new Map()
  for (const [id, node] of Object.entries(nodes)) {
    if (!isLegacyProceduralItem(node)) {
      report.passedThrough++
      continue
    }
    const converter = PROCEDURAL_CONVERTERS[node.asset.src]
    if (!converter) {
      unknown.push({ id, src: node.asset.src, name: node.name })
      continue
    }
    const migrated = converter(node, report.notes)
    delete nodes[id]
    nodes[migrated.id] = migrated
    idMap.set(id, migrated.id)
    report.converted.push({ from: id, to: migrated.id, type: migrated.type })
  }

  if (unknown.length > 0) {
    throw new MigrationError(
      `Eşlemesi tanımsız ${unknown.length} eski tip bulundu — taşıma durduruldu, hiçbir düğüm atlanmadı`,
      unknown,
    )
  }

  const mapId = (id) => idMap.get(id) ?? id
  rootNodeIds = rootNodeIds.map(mapId).filter((id) => id in nodes)
  for (const node of Object.values(nodes)) {
    if (Array.isArray(node.children)) {
      node.children = node.children.map(mapId).filter((id) => id in nodes)
    }
    if (typeof node.parentId === 'string') node.parentId = mapId(node.parentId)
  }

  // The legacy writer left `parentId: null` on nodes their parents list as
  // children; the children arrays are the authoritative record.
  for (const node of Object.values(nodes)) {
    for (const childId of node.children ?? []) {
      const child = nodes[childId]
      if (child && child.parentId !== node.id) {
        child.parentId = node.id
        report.repairedParentIds++
      }
    }
  }

  const graph = { nodes, rootNodeIds }
  if (report.converted.some((c) => c.type.startsWith('warehouse:'))) {
    const installed = new Set(legacyGraph.installedPlugins ?? [])
    installed.add(WAREHOUSE_PLUGIN_ID)
    graph.installedPlugins = [...installed]
  } else if (legacyGraph.installedPlugins) {
    graph.installedPlugins = [...legacyGraph.installedPlugins]
  }

  return { graph, report }
}

/** Node-type + procedural-kind frequency count, for the migration inventory. */
export function inventory(legacyGraph) {
  const counts = {}
  for (const node of Object.values(legacyGraph.nodes ?? {})) {
    const key = isLegacyProceduralItem(node) ? `item → ${node.asset.src}` : (node?.type ?? '?')
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json' || a === '--db' || a === '--scene' || a === '--out') args[a.slice(2)] = argv[++i]
    else if (a === '--list') args.list = true
    else if (a === '--drop-transient') args.dropTransient = true
    else args._.push(a)
  }
  return args
}

/**
 * The legacy sqlite schema is discovered, not assumed: the table holding
 * scenes is whichever has both an id-like and a JSON/graph-like column.
 * Refuses loudly when nothing matches, printing what it saw instead.
 */
function openLegacyScenes(dbPath) {
  const { Database } = require('bun:sqlite')
  const db = new Database(dbPath, { readonly: true })
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all()
  const candidates = []
  for (const { name } of tables) {
    const cols = db.query(`PRAGMA table_info(${JSON.stringify(name).slice(1, -1)})`).all()
    const colNames = cols.map((c) => c.name.toLowerCase())
    const idCol = cols[colNames.indexOf('id')]
    const graphCol = cols.find((c) => ['graph', 'data', 'json', 'content', 'scene'].includes(c.name.toLowerCase()))
    if (idCol && graphCol) candidates.push({ table: name, idCol: idCol.name, graphCol: graphCol.name, cols })
  }
  if (candidates.length === 0) {
    const seen = tables.map((t) => t.name).join(', ') || '(hiç tablo yok)'
    throw new Error(`pascal.db içinde sahne tablosu bulunamadı. Görülen tablolar: ${seen}`)
  }
  return { db, ...candidates[0] }
}

function loadLegacySceneFromDb(dbPath, sceneId) {
  const { db, table, idCol, graphCol, cols } = openLegacyScenes(dbPath)
  const row = db.query(`SELECT * FROM ${table} WHERE ${idCol} = ?`).get(sceneId)
  if (!row) throw new Error(`Sahne '${sceneId}' ${table} tablosunda yok`)
  const parsed = JSON.parse(row[graphCol])
  // Some writers store the whole scene envelope in the JSON column, some just
  // the graph; accept either.
  const graph = parsed.graph ?? parsed
  const nameCol = cols.find((c) => c.name.toLowerCase() === 'name')
  return { id: sceneId, name: row[nameCol?.name] ?? parsed.name ?? 'Untitled scene', graph }
}

function listScenesInDb(dbPath) {
  const { db, table, idCol, graphCol, cols } = openLegacyScenes(dbPath)
  const nameCol = cols.find((c) => c.name.toLowerCase() === 'name')
  const rows = db.query(`SELECT * FROM ${table}`).all()
  return rows.map((row) => {
    let counts = {}
    try {
      const parsed = JSON.parse(row[graphCol])
      counts = inventory(parsed.graph ?? parsed)
    } catch {
      counts = { '!graf çözümlenemedi': 1 }
    }
    return { id: row[idCol], name: row[nameCol?.name], table, counts }
  })
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.list) {
    const scenes = args.db
      ? listScenesInDb(args.db)
      : [(({ id, name, graph }) => ({ id, name, counts: inventory(graph) }))(readJsonScene(args.json))]
    for (const s of scenes) {
      console.log(`\n${s.id}  ${s.name ?? ''}`)
      for (const [k, v] of Object.entries(s.counts)) console.log(`  ${v.toString().padStart(4)}  ${k}`)
    }
    return
  }

  const legacy = args.db ? loadLegacySceneFromDb(args.db, requireArg(args, 'scene')) : readJsonScene(args.json)
  const { graph, report } = migrateLegacyGraph(legacy.graph, { dropTransient: args.dropTransient })

  console.log(`Sahne: ${legacy.id} (${legacy.name})`)
  console.log(`  dönüştürülen: ${report.converted.length}, olduğu gibi geçen: ${report.passedThrough}`)
  for (const c of report.converted) console.log(`    ${c.from} → ${c.to} (${c.type})`)
  if (report.droppedTransient.length) console.log(`  atılan geçici düğümler: ${report.droppedTransient.join(', ')}`)
  if (report.repairedParentIds) console.log(`  onarılan parentId: ${report.repairedParentIds}`)
  for (const n of report.notes) console.log(`  not: ${n}`)

  // Same validation the server runs — a green migration is an accepted POST.
  return import('../apps/editor/lib/graph-schema.ts').then(({ apiGraphSchema }) => {
    const result = apiGraphSchema.safeParse(graph)
    if (!result.success) {
      console.error('\nŞema doğrulaması BAŞARISIZ — çıktı yazılmadı:')
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`)
      }
      process.exit(1)
    }
    const body = { id: legacy.id, name: legacy.name, graph }
    const out = args.out ?? `${legacy.id}.migrated.json`
    fs.writeFileSync(out, JSON.stringify(body, null, 2))
    console.log(`\nŞema doğrulaması geçti ✓ → ${path.resolve(out)}`)
  })
}

function readJsonScene(file) {
  if (!file) throw new Error('--json <dosya> veya --db <pascal.db> --scene <id> gerekli')
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { id: parsed.id, name: parsed.name ?? 'Untitled scene', graph: parsed.graph ?? parsed }
}

function requireArg(args, name) {
  if (!args[name]) throw new Error(`--${name} gerekli`)
  return args[name]
}

if (import.meta.main) main()

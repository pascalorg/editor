import { FIND_BY_TYPE_LIMIT } from '../agent-tools/find-by-type'
import { refuse } from '../agent-tools/refusal'
import { isScriptedNode } from '../lib/geometry-script-node'
import { measurementCentroid } from '../lib/measurement-geometry'
import { nodeLevelFrame } from '../procedural-items/query'
import { type Frame, transformPoint } from '../procedural-items/spatial'
import { nodeRegistry } from '../registry'
import {
  type AnyNode,
  AnyNode as AnyNodeSchema,
  type ItemNode,
  nodeKindOf,
  type ZoneNode,
} from '../schema'
import { pointInPolygon } from '../systems/slab/slab-support'
import { requireLevel } from './level-target'
import type { Vec2 } from './plan-geometry'
import { levelIdOf } from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

type Vec3 = [number, number, number]

export type FindByTypeInput = {
  type?: string
  levelId?: string
  parentId?: string
  zoneId?: string
  sourceId?: string
  sourceIdPrefix?: string
  limit?: number
}

type Bounds = { min: Vec3; max: Vec3 }

/** One result: a node, or a typed part of one, with its bounds in level coordinates when known. */
type Found = Record<string, unknown> & { part?: string; bounds?: Bounds }

const round = (v: number) => Math.round(v * 1000) / 1000

/** A point in an item's frame, in its level's frame (items on a level: position + yaw). */
function toLevel(item: ItemNode, [x, y, z]: Vec3): Vec3 {
  const yaw = item.rotation[1] ?? 0
  const [sx, sy, sz] = item.scale
  const lx = x * sx
  const lz = z * sz
  return [
    round(item.position[0] + Math.cos(yaw) * lx + Math.sin(yaw) * lz),
    round(item.position[1] + y * sy),
    round(item.position[2] - Math.sin(yaw) * lx + Math.cos(yaw) * lz),
  ]
}

function boundsInLevel(item: ItemNode, bounds: Bounds): Bounds {
  const corners: Vec3[] = []
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push(toLevel(item, [x, y, z]))
  return {
    min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]!))) as Vec3,
    max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]!))) as Vec3,
  }
}

const CORE_KINDS = new Set<string>(AnyNodeSchema.options.map(nodeKindOf))

/** A node's kind, lower case; a malformed node stored without one has none. */
const kindOf = (node: AnyNode) => String(node.type).toLowerCase()

const emitsLight = (node: AnyNode) =>
  node.type === 'item' &&
  Boolean(node.asset?.interactive?.effects?.some((effect) => effect.kind === 'light'))

const matchesWord = (text: string | undefined, word: string) =>
  Boolean(text) &&
  text!
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes(word)

/**
 * A source id as importers write it into typed provenance: printable ASCII kept, every other
 * character percent-encoded as UTF-8 bytes.
 */
function encodeSourceId(id: string): string {
  let out = ''
  for (const char of id) {
    if (/^[\x20-\x7E]$/.test(char)) {
      out += char
      continue
    }
    for (const byte of new TextEncoder().encode(char))
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** A node's import source ids: typed `provenance.refs[].id`, then legacy `metadata.sourceIds`. */
function sourceIdsOf(node: AnyNode): string[] {
  const typed = (node.provenance?.refs ?? []).map((ref) => ref.id)
  const legacy = (node.metadata as { sourceIds?: unknown } | undefined)?.sourceIds
  return Array.isArray(legacy)
    ? [...typed, ...legacy.filter((id): id is string => typeof id === 'string')]
    : typed
}

/** The source filters as one test; a legacy id may be stored raw, a typed one percent-encoded. */
function sourceFilter({ sourceId, sourceIdPrefix }: FindByTypeInput) {
  if (sourceId === undefined && sourceIdPrefix === undefined) return undefined
  const exact = sourceId === undefined ? [] : [sourceId, encodeSourceId(sourceId)]
  const prefixes =
    sourceIdPrefix === undefined ? [] : [sourceIdPrefix, encodeSourceId(sourceIdPrefix)]
  return (node: AnyNode) => {
    const ids = sourceIdsOf(node)
    return (
      (sourceId === undefined || ids.some((id) => exact.includes(id))) &&
      (sourceIdPrefix === undefined ||
        ids.some((id) => prefixes.some((prefix) => id.startsWith(prefix))))
    )
  }
}

function centre2(points: readonly Vec2[]): Vec2 | null {
  if (points.length === 0) return null
  const area = measurementCentroid(points.map(([x, z]) => [x, 0, z] as Vec3))
  if (area) return [area[0], area[2]]
  const sum = points.reduce<Vec2>(([sx, sz], [x, z]) => [sx + x, sz + z], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

function boundsCentre3(points: readonly Vec3[]): Vec3 | null {
  if (points.length === 0) return null
  return [0, 1, 2].map((axis) => {
    const values = points.map((p) => p[axis]!)
    return (Math.min(...values) + Math.max(...values)) / 2
  }) as Vec3
}

/**
 * Where a node stands in its level's plan: a polygon's area centroid, a segment's midpoint, a
 * path's centre, or the origin of a positioned node through its hosts (a window in its wall, a
 * module in its cabinet); a block or an imported mesh by the centre of its vertex bounds, turned in
 * 3D before it is projected. Plan-only frames, one cache per query, so each host resolves once.
 */
function planPointOf(node: AnyNode, nodes: SceneNodes, frames: Map<string, Frame>): Vec2 | null {
  const n = node as Record<string, unknown>
  if (Array.isArray(n.polygon)) return centre2(n.polygon as Vec2[])
  if (Array.isArray(n.start) && Array.isArray(n.end)) {
    const [x1, z1] = n.start as Vec2
    const [x2, z2] = n.end as Vec2
    return [(x1 + x2) / 2, (z1 + z2) / 2]
  }
  if (Array.isArray(n.path)) {
    const centre = boundsCentre3(n.path as Vec3[])
    return centre ? [centre[0], centre[2]] : null
  }
  if (!Array.isArray(n.position)) return null
  let frame: Frame
  try {
    frame = nodeLevelFrame(node.id, nodes, undefined, { cache: frames, planOnly: true })
  } catch {
    return null
  }
  const local =
    node.type === 'block'
      ? boundsCentre3((node.topology?.vertices ?? []).map((vertex) => vertex.position as Vec3))
      : node.type === 'imported-mesh'
        ? boundsCentre3(
            (node.primitives ?? []).flatMap(({ positions }) => {
              const out: Vec3[] = []
              for (let i = 0; i + 2 < positions.length; i += 3)
                out.push([positions[i]!, positions[i + 1]!, positions[i + 2]!])
              return out
            }),
          )
        : null
  const [x, , z] = transformPoint(frame, local ?? [0, 0, 0])
  return [x, z]
}

function requireZone(nodes: SceneNodes, zoneId: string): ZoneNode {
  const zone = nodes[zoneId]
  if (!zone)
    refuse('zone_not_found', `Zone not found: ${zoneId}. Use a zoneId get_zones returned.`, {
      zoneId,
    })
  if (zone.type !== 'zone')
    refuse('not_a_zone', `Node ${zoneId} is a ${zone.type}, not a zone.`, {
      zoneId,
      type: zone.type,
    })
  return zone
}

/**
 * What of a node's results stands in this zone: on the zone's level, a plan point inside its outline
 * and outside its holes, by the ray cast the editor's spatial grid uses (a closing vertex repeated,
 * or a zero-length edge, puts nothing inside). A part with bounds in its level stands at their
 * middle; anything else at its node's plan point, read only once the node is on the zone's level.
 */
function zoneFilter(nodes: SceneNodes, zone: ZoneNode) {
  const zoneLevel = levelIdOf(nodes, zone.id)
  const outline = zone.polygon as Vec2[]
  const holes = (zone.holes ?? []) as Vec2[][]
  const frames = new Map<string, Frame>()
  const inside = (point: Vec2 | null) =>
    point !== null &&
    pointInPolygon(point[0], point[1], outline) &&
    !holes.some((hole) => pointInPolygon(point[0], point[1], hole))
  return (node: AnyNode, level: string | null, found: Found[]) => {
    if (level !== zoneLevel) return []
    let planPoint: Vec2 | null | undefined
    const nodePoint = () => {
      if (planPoint === undefined) planPoint = planPointOf(node, nodes, frames)
      return planPoint
    }
    return found.filter(({ bounds }) =>
      inside(
        bounds
          ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2]
          : nodePoint(),
      ),
    )
  }
}

/** Past this much JSON, a result leaves a record out and names it in `omitted`: get_node reads it. */
const RECORD_BYTES = 1024

/** What a whole node records about itself (an importer's ids, Architect's marks), when it is small. */
function recordsOf(node: AnyNode) {
  const out: Record<string, unknown> = {}
  const omitted: string[] = []
  const records = { metadata: node.metadata, provenance: node.provenance }
  for (const [field, value] of Object.entries(records)) {
    if (!value || Object.keys(value).length === 0) continue
    if (JSON.stringify(value).length > RECORD_BYTES) omitted.push(field)
    else out[field] = value
  }
  return omitted.length ? { ...out, omitted } : out
}

/**
 * Whether a type word, or its singular, names anything find_by_type reads: a core kind or a
 * registered plugin kind anywhere, light, or a kind, an item category or a typed part in this scene.
 */
function namesAnything(nodes: SceneNodes, names: Set<string>): boolean {
  if (names.has('light')) return true
  const registered = [...nodeRegistry.entries()].map(([kind]) => kind.toLowerCase())
  if ([...names].some((name) => CORE_KINDS.has(name) || registered.includes(name))) return true
  return Object.values(nodes).some(
    (node) =>
      names.has(kindOf(node)) ||
      (node.type === 'item' &&
        [...names].some((name) => matchesWord(node.asset?.category, name))) ||
      (isScriptedNode(node) &&
        (node.source?.manifest?.parts ?? []).some((part) => part.type && names.has(part.type))),
  )
}

/**
 * `find_by_type`: everything of one type, nodes and the typed parts of authored objects alike,
 * narrowed by level, parent, zone or source id. Parts are read from each object's manifest; the
 * object stays the thing that is selected, moved and edited. Each result is the node's summary;
 * `get_node` reads it whole. Past `limit` results are counted, not listed.
 */
export const findByType: AgentOperation<FindByTypeInput> = (nodes, input) => {
  const { levelId, parentId, zoneId } = input
  // A level, parent or zone that is not there is said, as get_zones says it, not answered with
  // nothing found: the agent could not tell a typo from an empty floor.
  if (levelId) requireLevel(nodes, levelId)
  if (parentId && !nodes[parentId])
    refuse('node_not_found', `Node not found: ${parentId}.`, { id: parentId })
  const inZone = zoneId ? zoneFilter(nodes, requireZone(nodes, zoneId)) : undefined
  const fromSource = sourceFilter(input)
  // What was asked, as written; a word also in the singular ("walls"), a plugin's kind
  // (`bones:studs`) never.
  const kind = input.type?.trim().toLowerCase()
  const names =
    kind === undefined
      ? undefined
      : new Set([kind, kind.includes(':') ? kind : kind.replace(/s$/, '')])
  const results: Found[] = []
  for (const node of Object.values(nodes)) {
    if (parentId && node.parentId !== parentId) continue
    if (fromSource && !fromSource(node)) continue
    const level = levelIdOf(nodes, node.id)
    if (levelId && level !== levelId) continue
    const item = node.type === 'item' ? node : null
    const found = {
      id: node.id,
      name: node.name ?? item?.asset?.name,
      nodeType: node.type,
      levelId: level,
      parentId: node.parentId ?? null,
    }
    const whole = { ...found, ...recordsOf(node) }
    let matched: Found[]
    if (names === undefined) matched = [whole]
    else {
      const typed = (isScriptedNode(node) ? (node.source?.manifest?.parts ?? []) : []).filter(
        (part) => part.type,
      )
      const typedParts = typed.filter((part) => names.has(part.type!))
      // An authored item whose typed parts are all of this type is one (a lantern); a mixed one (a
      // porch), or a window, door or column, answers with its parts.
      const wholeAuthored =
        item !== null && typedParts.length > 0 && typedParts.length === typed.length
      const wholeMatch =
        names.has(kindOf(node)) ||
        wholeAuthored ||
        (item &&
          ([...names].some((name) => matchesWord(item.asset?.category, name)) ||
            (names.has('light') && emitsLight(node) && typedParts.length === 0)))
      matched = wholeMatch
        ? [whole]
        : typedParts.map((part) => ({
            ...found,
            part: part.id,
            partType: part.type,
            ...(part.bounds && item && item.parentId === level
              ? { bounds: boundsInLevel(item, part.bounds) }
              : {}),
          }))
    }
    // Where a node stands is read only for what matched: the zone test reads geometry.
    if (matched.length > 0) results.push(...(inZone ? inZone(node, level, matched) : matched))
  }
  if (names && results.length === 0 && !namesAnything(nodes, names)) {
    const kinds = [...new Set(Object.values(nodes).map(kindOf))].sort()
    refuse(
      'unknown_type',
      `"${kind}" names nothing find_by_type reads: no node kind (core's or a registered plugin's), and no item category or part type in this scene. Kinds in this scene: ${kinds.join(', ')}.`,
      { type: kind, kinds },
    )
  }
  const limit = input.limit ?? FIND_BY_TYPE_LIMIT
  const parts = results.filter((entry) => entry.part).length
  return {
    result: {
      ...(kind === undefined ? {} : { type: kind }),
      count: results.length,
      nodes: results.length - parts,
      parts,
      results: results.slice(0, limit),
      ...(results.length > limit
        ? {
            truncated: true,
            hint: `${limit} of ${results.length} listed. Narrow by type, levelId, zoneId or parentId, or ask for more with limit.`,
          }
        : {}),
    },
  }
}

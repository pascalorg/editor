import { refuse } from '../agent-tools/refusal'
import { isScriptedNode } from '../lib/geometry-script-node'
import { measurementCentroid } from '../lib/measurement-geometry'
import { nodeLevelFrame } from '../procedural-items/query'
import { type Frame, transformPoint } from '../procedural-items/spatial'
import type { AnyNode, ItemNode, ZoneNode } from '../schema'
import { requireLevel } from './level-target'
import { pointInPolygon, type Vec2 } from './plan-geometry'
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
}

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

function boundsInLevel(item: ItemNode, bounds: { min: Vec3; max: Vec3 }) {
  const corners: Vec3[] = []
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push(toLevel(item, [x, y, z]))
  return {
    min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]!))) as Vec3,
    max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]!))) as Vec3,
  }
}

const emitsLight = (node: AnyNode) =>
  node.type === 'item' &&
  Boolean(node.asset.interactive?.effects.some((effect) => effect.kind === 'light'))

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
      ? boundsCentre3(node.topology.vertices.map((vertex) => vertex.position as Vec3))
      : node.type === 'imported-mesh'
        ? boundsCentre3(
            node.primitives.flatMap(({ positions }) => {
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

/** A test for "stands in this zone": on the zone's level, its plan point inside the polygon. */
function zoneFilter(nodes: SceneNodes, zone: ZoneNode) {
  const zoneLevel = levelIdOf(nodes, zone.id)
  const polygon = zone.polygon as Vec2[]
  const frames = new Map<string, Frame>()
  return (node: AnyNode, level: string | null) => {
    if (level !== zoneLevel) return false
    const point = planPointOf(node, nodes, frames)
    return point !== null && pointInPolygon(point, polygon)
  }
}

const isEmpty = (record: object) => Object.keys(record).length === 0

/**
 * `find_by_type`: everything of one type, nodes and the typed parts of authored objects alike,
 * narrowed by level, parent, zone or source id. Parts are read from each object's manifest; the
 * object stays the thing that is selected, moved and edited. Each result is the node's summary;
 * `get_node` reads it whole.
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
  // A kind as written (`fixture:bench`, `bones:studs`), or one word in the singular.
  const kind = input.type?.trim().toLowerCase()
  const word = kind?.replace(/s$/, '')
  const results: Record<string, unknown>[] = []
  for (const node of Object.values(nodes)) {
    const level = levelIdOf(nodes, node.id)
    if (levelId && level !== levelId) continue
    if (parentId && node.parentId !== parentId) continue
    if (fromSource && !fromSource(node)) continue
    if (inZone && !inZone(node, level)) continue
    const item = node.type === 'item' ? node : null
    const found = {
      id: node.id,
      name: node.name ?? item?.asset.name,
      nodeType: node.type,
      levelId: level,
      parentId: node.parentId ?? null,
    }
    // A whole node also says what it records about itself: an importer's ids, Architect's marks.
    const whole = {
      ...found,
      ...(node.metadata && !isEmpty(node.metadata) ? { metadata: node.metadata } : {}),
      ...(node.provenance ? { provenance: node.provenance } : {}),
    }
    if (kind === undefined || word === undefined) {
      results.push(whole)
      continue
    }
    const typed = (isScriptedNode(node) ? node.source.manifest.parts : []).filter(
      (part) => part.type,
    )
    const typedParts = typed.filter((part) => part.type === word || part.type === kind)
    // An authored item whose typed parts are all of this type is one (a lantern); a mixed one (a
    // porch), or a window, door or column, answers with its parts.
    const wholeAuthored =
      item !== null && typedParts.length > 0 && typedParts.length === typed.length
    const wholeMatch =
      node.type === kind ||
      node.type === word ||
      wholeAuthored ||
      (item &&
        (matchesWord(item.asset.category, word) ||
          (word === 'light' && emitsLight(node) && typedParts.length === 0)))
    if (wholeMatch) {
      results.push(whole)
      continue
    }
    for (const part of typedParts) {
      results.push({
        ...found,
        part: part.id,
        partType: part.type,
        ...(part.bounds && item && item.parentId === level
          ? { bounds: boundsInLevel(item, part.bounds) }
          : {}),
      })
    }
  }
  return {
    result: {
      ...(word === undefined ? {} : { type: word }),
      count: results.length,
      nodes: results.filter((entry) => !entry.part).length,
      parts: results.filter((entry) => entry.part).length,
      results,
    },
  }
}

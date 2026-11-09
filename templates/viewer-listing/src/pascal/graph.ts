import { z } from 'zod/mini'
import type { SceneGraph, SceneNode } from './contract'

/**
 * Read helpers over the projected scene graph. Every node points at its parent
 * through `parentId`; a site holds buildings, a building holds levels, a level
 * holds walls, slabs, zones (rooms), items and so on. The baked GLB names each
 * node after its graph id (`node.name === extras.pascalId`), which is how a hit
 * in the 3D file maps back to the graph.
 */

export type Point2 = [number, number]

export type LevelInfo = {
  id: string
  /** The storey index; 0 is the ground floor, negatives are basements. */
  index: number
  /** What Pascal's own UI calls this level. */
  name: string
}

export type ZoneInfo = {
  id: string
  name: string | null
  /** Outline in the zone's own x/z plane, metres. */
  polygon: Point2[]
  holes: Point2[][]
}

const PointSchema = z.tuple([z.number(), z.number()])
const ZoneFieldsSchema = z.object({
  polygon: z.array(PointSchema).check(z.minLength(3)),
  holes: z.optional(z.array(z.array(PointSchema))),
})
const LevelFieldsSchema = z.object({ level: z.optional(z.number()) })

export function getNode(graph: SceneGraph, id: string): SceneNode | undefined {
  return graph.nodes[id]
}

/** The node itself or its nearest ancestor of `type`, following `parentId`. */
export function findAncestorOfType(graph: SceneGraph, id: string, type: string): SceneNode | null {
  const seen = new Set<string>()
  let node = graph.nodes[id]
  while (node && !seen.has(node.id)) {
    if (node.type === type) return node
    seen.add(node.id)
    node = node.parentId ? graph.nodes[node.parentId] : undefined
  }
  return null
}

/** The level a node belongs to, or null for nodes above levels (site, building). */
export function levelIdOf(graph: SceneGraph, id: string): string | null {
  return findAncestorOfType(graph, id, 'level')?.id ?? null
}

/**
 * Pascal's name for a level: the name its owner gave, else its place in the
 * building. "Level N" is what older versions stamped on every new level, so it
 * reads as unnamed.
 */
export function levelDisplayName(name: string | undefined, index: number): string {
  const given = name?.trim()
  if (given && given !== `Level ${index}`) return given
  if (index === 0) return 'Ground floor'
  if (index > 0) return `Floor ${index}`
  return index === -1 ? 'Basement' : `Basement ${-index}`
}

/** Every level, lowest storey first. */
export function listLevels(graph: SceneGraph): LevelInfo[] {
  return Object.values(graph.nodes)
    .filter((node) => node.type === 'level')
    .map((node) => {
      const index = LevelFieldsSchema.safeParse(node).data?.level ?? 0
      return { id: node.id, index, name: levelDisplayName(node.name, index) }
    })
    .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
}

export function zoneInfo(node: SceneNode, fallback?: { polygon?: unknown }): ZoneInfo | null {
  if (node.type !== 'zone') return null
  const fields = ZoneFieldsSchema.safeParse(node).data ?? ZoneFieldsSchema.safeParse(fallback).data
  if (!fields) return null
  return {
    id: node.id,
    name: node.name?.trim() || null,
    polygon: fields.polygon,
    holes: fields.holes ?? [],
  }
}

/** Every zone on a level. */
export function zonesOnLevel(graph: SceneGraph, levelId: string): ZoneInfo[] {
  return Object.values(graph.nodes)
    .filter((node) => node.type === 'zone' && levelIdOf(graph, node.id) === levelId)
    .map((node) => zoneInfo(node))
    .filter((zone): zone is ZoneInfo => zone !== null)
}

/** Shoelace area of a closed outline, always positive. */
export function polygonArea(points: readonly Point2[]): number {
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!
    const [x2, z2] = points[(i + 1) % points.length]!
    twice += x1 * z2 - x2 * z1
  }
  return Math.abs(twice) / 2
}

/** Floor area of a zone in square metres: outline minus holes. */
export function zoneArea(zone: Pick<ZoneInfo, 'polygon' | 'holes'>): number {
  const holes = zone.holes.reduce((sum, hole) => sum + polygonArea(hole), 0)
  return Math.max(0, polygonArea(zone.polygon) - holes)
}

function insideOutline(points: readonly Point2[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!
    const [xj, zj] = points[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Whether a point in the zone's own x/z plane lies on its floor. */
export function zoneContains(zone: Pick<ZoneInfo, 'polygon' | 'holes'>, x: number, z: number) {
  return insideOutline(zone.polygon, x, z) && !zone.holes.some((hole) => insideOutline(hole, x, z))
}

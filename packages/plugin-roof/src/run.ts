/**
 * Scene glue for the auto roof: read a level's walls, derive, replace the
 * level's derived roof, tell each wall what it carries. The engine
 * (`derive.ts`) is pure; this is the only file that touches the stores.
 */
import { DEFAULT_LEVEL_HEIGHT, type AnyNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type AutoRoofResult, type AutoRoofSegment, deriveRoof, type RoofIntent } from './derive'
import type { Pt, WallInput } from './geometry'
import { type AutoRoofOptions, summarise, useAutoRoof } from './store'

/** Stamped on the roof group the engine makes, so a rebuild replaces it and nothing else. */
export const AUTO_ROOF = 'pascal:roof'

type NodeLike = Record<string, unknown> & { id: string; type?: string; parentId?: string | null; children?: string[] }
type Nodes = Record<string, NodeLike>

const IN = 0.0254

export function wallsOfLevel(nodes: Nodes, levelId: string): WallInput[] {
  const level = nodes[levelId]
  if (!level) return []
  return (level.children ?? [])
    .map((id) => nodes[id])
    .filter((n): n is NodeLike => n?.type === 'wall')
    .map((w) => ({
      id: w.id,
      start: w.start as Pt,
      end: w.end as Pt,
      thickness: typeof w.thickness === 'number' ? w.thickness : 0.15,
      frontSide: typeof w.frontSide === 'string' ? w.frontSide : undefined,
      backSide: typeof w.backSide === 'string' ? w.backSide : undefined,
    }))
}

/** Top of the level's plate: its storey height. */
export function plateOfLevel(nodes: Nodes, levelId: string): number {
  const level = nodes[levelId]
  return typeof level?.height === 'number' ? level.height : DEFAULT_LEVEL_HEIGHT
}

/**
 * Which way the street is, in the level's frame: the outward normal of the
 * site's front edge turned by the building's yaw. A generated house faces
 * its own −Z; a house with no lot gets the same default.
 */
export function frontDirOfLevel(nodes: Nodes, levelId: string): Pt {
  const level = nodes[levelId]
  const building = level?.parentId ? nodes[level.parentId] : undefined
  const site = building?.parentId ? nodes[building.parentId] : undefined
  const polygon = (site?.polygon as { points?: Pt[] } | undefined)?.points
  if (!site || site.type !== 'site' || !polygon || polygon.length < 3) return [0, -1]
  const front = typeof site.frontEdge === 'number' && site.frontEdge >= 0 && site.frontEdge < polygon.length ? site.frontEdge : null
  if (front === null) return [0, -1]
  const a = polygon[front] as Pt
  const b = polygon[(front + 1) % polygon.length] as Pt
  const d: Pt = [b[0] - a[0], b[1] - a[1]]
  const l = Math.hypot(d[0], d[1]) || 1
  // outward = away from the polygon's interior (its centroid)
  let cx = 0
  let cz = 0
  for (const p of polygon) {
    cx += p[0] / polygon.length
    cz += p[1] / polygon.length
  }
  const left: Pt = [-d[1] / l, d[0] / l]
  const toCentre: Pt = [cx - (a[0] + b[0]) / 2, cz - (a[1] + b[1]) / 2]
  const outward: Pt = left[0] * toCentre[0] + left[1] * toCentre[1] > 0 ? [-left[0], -left[1]] : left
  // site → level: undo the building's yaw (three Y-rotation: +X → (cos, −sin))
  const rot = building?.rotation as number[] | undefined
  const yaw = Array.isArray(rot) ? (rot[1] ?? 0) : 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [outward[0] * c - outward[1] * s, outward[0] * s + outward[1] * c]
}

export function intentFromOptions(o: AutoRoofOptions, styleForm: (style: string) => RoofIntent['form'] | null): RoofIntent {
  const form = o.form === 'auto' ? (styleForm(o.style) ?? 'gable') : o.form
  return { form, pitchTwelfths: o.pitchTwelfths, overhang: o.overhangIn * IN, style: o.style || undefined }
}

/** The roof group + segment nodes for a derived roof, parent-first. */
export function roofNodesFor(
  result: AutoRoofResult,
  levelId: string,
  ids: { roofId: string; segmentId: () => string },
  meta: Record<string, unknown> = {},
): { node: Record<string, unknown>; parentId: string }[] {
  const roof = {
    id: ids.roofId,
    type: 'roof',
    name: 'Roof',
    parentId: levelId,
    position: [0, 0, 0],
    rotation: 0,
    metadata: { generatedBy: AUTO_ROOF, autoRoof: { ...meta, coverage: result.coverage, masses: result.masses, popped: result.popped } },
    children: [] as string[],
  }
  const ops: { node: Record<string, unknown>; parentId: string }[] = [{ node: roof, parentId: levelId }]
  for (const s of result.segments) {
    const id = ids.segmentId()
    roof.children.push(id)
    ops.push({ node: { ...segmentNode(s), id, parentId: ids.roofId }, parentId: ids.roofId })
  }
  return ops
}

function segmentNode(s: AutoRoofSegment): Record<string, unknown> {
  return {
    type: 'roof-segment',
    name: s.name,
    position: s.position,
    rotation: s.rotation,
    roofType: s.roofType,
    width: round(s.width),
    depth: round(s.depth),
    wallHeight: round(s.wallHeight),
    wallThickness: round(s.wallThickness),
    pitch: s.pitch,
    overhang: round(s.overhang),
    metadata: { generatedBy: AUTO_ROOF },
  }
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6

let counter = 0
const freshId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Rebuild the derived roof on `levelId` (default: the level in the viewer's
 * selection). Any previous derived roof on that level goes; hand-placed roofs
 * stay. Every exterior wall gets `metadata.roof.role`.
 */
export function rebuildAutoRoof(
  options: AutoRoofOptions,
  styleForm: (style: string) => RoofIntent['form'] | null,
  levelId: string | null = useViewer.getState().selection.levelId ?? null,
): AutoRoofResult | null {
  const store = useAutoRoof.getState()
  if (!levelId) {
    store.setLast({ ...summarise(null, emptyResult()), errors: ['select a level first'] })
    return null
  }
  const scene = useScene.getState()
  const nodes = scene.nodes as unknown as Nodes
  const walls = wallsOfLevel(nodes, levelId)
  if (walls.length === 0) {
    store.setLast({ ...summarise(levelId, emptyResult()), errors: ['the level has no walls to roof'] })
    return null
  }
  const intent: RoofIntent = { ...intentFromOptions(options, styleForm), frontDir: frontDirOfLevel(nodes, levelId) }
  const result = deriveRoof(walls, plateOfLevel(nodes, levelId), intent)
  store.setRunning(true)
  try {
    const previous = (nodes[levelId]?.children ?? []).filter((id) => {
      const n = nodes[id]
      return n?.type === 'roof' && (n.metadata as { generatedBy?: string } | undefined)?.generatedBy === AUTO_ROOF
    })
    if (previous.length > 0) scene.deleteNodes(previous as never)
    const ops = roofNodesFor(result, levelId, { roofId: freshId('roof'), segmentId: () => freshId('rseg') }, { options })
    scene.createNodes(ops.map((op) => ({ node: op.node as never, parentId: op.parentId as never })))
    for (const [wallId, role] of Object.entries(result.roles)) {
      const wall = nodes[wallId]
      if (!wall) continue
      const metadata = { ...((wall.metadata as Record<string, unknown> | undefined) ?? {}), roof: { role } }
      scene.updateNode(wallId as never, { metadata } as never)
    }
    store.setLast(summarise(levelId, result))
  } finally {
    store.setRunning(false)
  }
  return result
}

const emptyResult = (): AutoRoofResult => ({ ok: false, segments: [], roles: {}, warnings: [], coverage: 0, masses: 0, popped: false })

export type { AnyNode }
